<?php
// Show PHP errors as JSON instead of HTML so we can debug from the client.
ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);
set_error_handler(function ($severity, $message, $file, $line) {
    if (!(error_reporting() & $severity)) return false;
    throw new ErrorException($message, 0, $severity, $file, $line);
});
set_exception_handler(function ($e) {
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json');
    }
    echo json_encode([
        'ok' => false,
        'error' => 'php_exception',
        'type' => get_class($e),
        'message' => $e->getMessage(),
        'file' => basename($e->getFile()),
        'line' => $e->getLine(),
    ]);
    exit;
});

/**
 * ShopOS storage gateway — runs on HostGator (PHP), called over HTTPS by the
 * ShopOS backend. Files are stored OUTSIDE public_html so they are not
 * publicly accessible. Every request must carry X-Auth-Token matching the
 * AUTH_TOKEN constant below.
 *
 * Setup (one time):
 *   1. Replace AUTH_TOKEN below with the value of HOSTGATOR_STORAGE_TOKEN
 *      from the ShopOS backend secrets.
 *   2. Upload this file to public_html/shopos-storage.php on HostGator.
 *   3. Files will be saved to {HOME}/shopos-files/ (auto-created), where
 *      {HOME} is the parent of public_html (typically /home/<cpanel-user>/).
 *
 * Endpoints (all require header  X-Auth-Token: <token>):
 *
 *   POST ?action=upload
 *        multipart/form-data: file=<binary>, ownerType=<str>, ownerId=<int>
 *        → { ok: true, storagePath: "owners/repair_order/12/1730000000-foo.png" }
 *
 *   GET  ?action=download&path=<storagePath>
 *        → streams raw file bytes
 *
 *   POST ?action=delete
 *        application/x-www-form-urlencoded: path=<storagePath>
 *        → { ok: true }
 */

// =====================================================================
// CONFIG — paste the value of HOSTGATOR_STORAGE_TOKEN from your Replit
// Secrets here. NEVER commit this file with a real token.
// =====================================================================
const AUTH_TOKEN = 'PASTE_HOSTGATOR_STORAGE_TOKEN_HERE';

// Maximum upload size (bytes). 25 MB matches the Node-side multer limit.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// MIME types accepted by the gateway. Mirrors the Node-side allowlist.
$ALLOWED_MIME_PREFIXES = ['image/'];
$ALLOWED_MIME_EXACT    = ['application/pdf'];

// Storage root: walk up from this script's directory until we leave
// public_html, so the storage folder is never web-accessible regardless of
// whether the script lives in public_html/ or in a subfolder like
// public_html/<addondomain>/.
function compute_storage_root() {
    $dir = __DIR__;
    // Walk up until the parent path no longer contains 'public_html'.
    for ($i = 0; $i < 8; $i++) {
        $parent = dirname($dir);
        if ($parent === $dir || $parent === '/' || $parent === '') break;
        if (strpos($parent, 'public_html') === false) {
            // $parent is now /home/<cpanel-user> (outside public_html).
            return $parent . '/shopos-files';
        }
        $dir = $parent;
    }
    // Fallback: two levels up from the script.
    return realpath(__DIR__ . '/../..') . '/shopos-files';
}
$STORAGE_ROOT = compute_storage_root();

// =====================================================================
// Helpers
// =====================================================================
function fail($status, $msg) {
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => $msg]);
    exit;
}

function ok($data = []) {
    header('Content-Type: application/json');
    echo json_encode(array_merge(['ok' => true], $data));
    exit;
}

function check_auth() {
    $hdr = $_SERVER['HTTP_X_AUTH_TOKEN'] ?? '';
    if (!hash_equals(AUTH_TOKEN, $hdr)) {
        fail(401, 'unauthorized');
    }
}

function sanitize_segment($s) {
    return preg_replace('/[^a-zA-Z0-9._-]/', '_', (string)$s);
}

/**
 * Resolve a storagePath (relative, like "owners/repair_order/12/file.png")
 * against $STORAGE_ROOT, refusing any path that escapes the root.
 */
function resolve_safe_path($storagePath, $mustExist = true) {
    global $STORAGE_ROOT;
    $clean = ltrim(str_replace('\\', '/', $storagePath), '/');
    if ($clean === '' || strpos($clean, '..') !== false) {
        fail(400, 'invalid path');
    }
    $full = $STORAGE_ROOT . '/' . $clean;
    if ($mustExist) {
        $real = realpath($full);
        if ($real === false || strpos($real, $STORAGE_ROOT) !== 0) {
            fail(404, 'not found');
        }
        return $real;
    }
    // For new uploads: just verify the path stays under root after normalization.
    $normalized = $STORAGE_ROOT . '/' . $clean;
    if (strpos($normalized, $STORAGE_ROOT) !== 0) {
        fail(400, 'invalid path');
    }
    return $normalized;
}

// =====================================================================
// Bootstrap
// =====================================================================
check_auth();

if (!is_dir($STORAGE_ROOT)) {
    if (!mkdir($STORAGE_ROOT, 0700, true) && !is_dir($STORAGE_ROOT)) {
        fail(500, 'could not create storage root');
    }
}

$action = $_GET['action'] ?? '';

// =====================================================================
// UPLOAD
// =====================================================================
if ($action === 'upload') {
    global $ALLOWED_MIME_PREFIXES, $ALLOWED_MIME_EXACT;
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail(405, 'POST required');
    if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
        fail(400, 'file missing or upload error: ' . ($_FILES['file']['error'] ?? 'no file'));
    }
    $ownerType = sanitize_segment($_POST['ownerType'] ?? '');
    $ownerId   = sanitize_segment($_POST['ownerId'] ?? '');
    if ($ownerType === '' || $ownerId === '') fail(400, 'ownerType and ownerId required');

    // Enforce maximum upload size (defence in depth alongside Node-side limit).
    if ($_FILES['file']['size'] > MAX_UPLOAD_BYTES) {
        fail(413, 'file too large');
    }

    // Detect the real MIME from file contents (do NOT trust the client header).
    $detectedMime = null;
    if (function_exists('finfo_open')) {
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        if ($finfo !== false) {
            $detectedMime = finfo_file($finfo, $_FILES['file']['tmp_name']) ?: null;
            finfo_close($finfo);
        }
    }
    if ($detectedMime === null) {
        // Fallback to the client-supplied type if finfo isn't available.
        $detectedMime = $_FILES['file']['type'] ?? '';
    }
    $mimeOk = in_array($detectedMime, $ALLOWED_MIME_EXACT, true);
    if (!$mimeOk) {
        foreach ($ALLOWED_MIME_PREFIXES as $prefix) {
            if (strpos($detectedMime, $prefix) === 0) { $mimeOk = true; break; }
        }
    }
    if (!$mimeOk) fail(415, 'mime type not allowed: ' . $detectedMime);

    $orig = sanitize_segment(basename($_FILES['file']['name']));
    if (strlen($orig) > 180) $orig = substr($orig, -180);
    $filename = (string)round(microtime(true) * 1000) . '-' . $orig;

    $relDir = "owners/{$ownerType}/{$ownerId}";
    $absDir = $STORAGE_ROOT . '/' . $relDir;
    if (!is_dir($absDir) && !mkdir($absDir, 0700, true) && !is_dir($absDir)) {
        fail(500, 'could not create folder');
    }
    $relPath = $relDir . '/' . $filename;
    $absPath = $STORAGE_ROOT . '/' . $relPath;
    if (!move_uploaded_file($_FILES['file']['tmp_name'], $absPath)) {
        fail(500, 'could not save file');
    }
    @chmod($absPath, 0600);
    ok(['storagePath' => $relPath, 'size' => filesize($absPath)]);
}

// =====================================================================
// DOWNLOAD
// =====================================================================
if ($action === 'download') {
    $storagePath = $_GET['path'] ?? '';
    if ($storagePath === '') fail(400, 'path required');
    $abs = resolve_safe_path($storagePath, true);
    if (!is_file($abs)) fail(404, 'not found');

    header('Content-Type: application/octet-stream');
    header('Content-Length: ' . filesize($abs));
    header('Cache-Control: private, no-store');
    readfile($abs);
    exit;
}

// =====================================================================
// DELETE
// =====================================================================
if ($action === 'delete') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail(405, 'POST required');
    $storagePath = $_POST['path'] ?? '';
    if ($storagePath === '') fail(400, 'path required');
    $abs = resolve_safe_path($storagePath, false);
    if (is_file($abs)) {
        if (!unlink($abs)) fail(500, 'could not delete');
    }
    ok(['deleted' => true]);
}

// =====================================================================
// HEALTH
// =====================================================================
if ($action === 'health' || $action === '') {
    ok(['service' => 'shopos-storage', 'storageRootExists' => is_dir($STORAGE_ROOT)]);
}

fail(400, 'unknown action');
