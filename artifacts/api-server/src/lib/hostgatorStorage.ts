import SftpClient from "ssh2-sftp-client";
import { Readable } from "stream";
import path from "path";
import crypto from "crypto";
import { logger } from "./logger.js";

const HOST = process.env.HOSTGATOR_SFTP_HOST;
const PORT = Number(process.env.HOSTGATOR_SFTP_PORT || "2222");
const USER = process.env.HOSTGATOR_SFTP_USER;
const PASSWORD = process.env.HOSTGATOR_SFTP_PASSWORD;
const PRIVATE_KEY = decryptPemIfNeeded(
  normalizePem(process.env.HOSTGATOR_SFTP_PRIVATE_KEY),
  process.env.HOSTGATOR_SFTP_PRIVATE_KEY_PASSPHRASE,
);
const ROOT_DIR = process.env.HOSTGATOR_UPLOAD_DIR;

/**
 * ssh2's built-in parser fails on some legacy encrypted PEM keys produced by
 * HostGator's cPanel ("Malformed OpenSSH private key. Bad passphrase?" even
 * when the passphrase is correct). Use Node's native crypto to decrypt the
 * key once at startup and hand ssh2 an unencrypted PKCS#8 PEM, which it
 * parses reliably.
 */
function decryptPemIfNeeded(pem: string | undefined, passphrase: string | undefined): string | undefined {
  if (!pem) return pem;
  // Only act on encrypted keys; plain keys pass straight through.
  if (!/Proc-Type:\s*4,ENCRYPTED/i.test(pem) && !/ENCRYPTED PRIVATE KEY/.test(pem)) {
    return pem;
  }
  if (!passphrase) {
    logger.warn("[hostgatorStorage] private key is encrypted but no passphrase provided");
    return pem;
  }
  try {
    const keyObj = crypto.createPrivateKey({ key: pem, format: "pem", passphrase });
    // ssh2 v1 accepts traditional PKCS#1 RSA (BEGIN RSA PRIVATE KEY) but not
    // unencrypted PKCS#8 (BEGIN PRIVATE KEY) for RSA keys, so prefer pkcs1
    // when possible. Fall back to pkcs8 for non-RSA keys (EC/Ed25519).
    const exportType = keyObj.asymmetricKeyType === "rsa" ? "pkcs1" : "pkcs8";
    return keyObj.export({ format: "pem", type: exportType as any }) as string;
  } catch (err) {
    logger.error({ err }, "[hostgatorStorage] failed to decrypt private key");
    return pem;
  }
}

/**
 * Re-format a PEM key that was pasted as one line (newlines stripped by the
 * secret-entry field). Reconstructs BEGIN/headers/body/END structure with
 * proper newlines, so ssh2 can parse it.
 */
function normalizePem(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  let s = raw.trim().replace(/\r\n/g, "\n");
  // Convert literal "\n" (backslash-n) sequences into real newlines.
  if (!s.includes("\n") && s.includes("\\n")) s = s.replace(/\\n/g, "\n");
  if (s.includes("\n")) return s; // already multi-line — leave it

  const beginMatch = s.match(/-----BEGIN [A-Z0-9 ]+-----/);
  const endMatch = s.match(/-----END [A-Z0-9 ]+-----/);
  if (!beginMatch || !endMatch || beginMatch.index === undefined || endMatch.index === undefined) {
    return s;
  }
  const beginLine = beginMatch[0];
  const endLine = endMatch[0];
  let middle = s.slice(beginMatch.index + beginLine.length, endMatch.index).trim();

  // Pull out any "Header: value" lines (Proc-Type, DEK-Info, etc).
  const headerLines: string[] = [];
  let m: RegExpMatchArray | null;
  while ((m = middle.match(/^([A-Za-z-]+):\s*([^\s]+)\s*/))) {
    headerLines.push(`${m[1]}: ${m[2]}`);
    middle = middle.slice(m[0].length);
  }

  // The remainder is base64; strip whitespace and rewrap to 64 chars/line.
  const body = middle.replace(/\s+/g, "");
  const wrapped = body.match(/.{1,64}/g)?.join("\n") ?? body;

  const out: string[] = [beginLine];
  if (headerLines.length > 0) {
    out.push(...headerLines, "");
  }
  out.push(wrapped, endLine, "");
  return out.join("\n");
}

export class HostgatorStorageError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "HostgatorStorageError";
  }
}

export function isConfigured(): boolean {
  return Boolean(HOST && USER && (PASSWORD || PRIVATE_KEY) && ROOT_DIR);
}

function assertConfigured(): void {
  if (!isConfigured()) {
    throw new HostgatorStorageError(
      "HostGator SFTP is not configured. Set HOSTGATOR_SFTP_HOST/PORT/USER/PASSWORD/UPLOAD_DIR."
    );
  }
}

async function connect(): Promise<SftpClient> {
  assertConfigured();
  const sftp = new SftpClient();
  try {
    const authOpts: Record<string, unknown> = PRIVATE_KEY
      ? {
          privateKey: PRIVATE_KEY,
          ...(PASSWORD ? { password: PASSWORD } : {}),
        }
      : { password: PASSWORD as string };
    await sftp.connect({
      host: HOST as string,
      port: PORT,
      username: USER as string,
      ...authOpts,
      readyTimeout: 30000,
      // HostGator uses older OpenSSH versions; allow legacy algorithms
      algorithms: {
        kex: [
          "diffie-hellman-group-exchange-sha256",
          "diffie-hellman-group14-sha256",
          "diffie-hellman-group14-sha1",
          "diffie-hellman-group-exchange-sha1",
          "diffie-hellman-group1-sha1",
        ],
        cipher: [
          "aes128-ctr",
          "aes192-ctr",
          "aes256-ctr",
          "aes128-gcm",
          "aes256-gcm",
          "aes128-cbc",
          "aes192-cbc",
          "aes256-cbc",
          "3des-cbc",
        ],
        hmac: ["hmac-sha2-256", "hmac-sha2-512", "hmac-sha1", "hmac-md5"],
        serverHostKey: [
          "ssh-rsa",
          "rsa-sha2-256",
          "rsa-sha2-512",
          "ecdsa-sha2-nistp256",
          "ecdsa-sha2-nistp384",
          "ecdsa-sha2-nistp521",
          "ssh-ed25519",
        ],
      },
    } as any);
  } catch (err) {
    logger.error({ err }, "[hostgatorStorage] SFTP connect failed");
    throw new HostgatorStorageError("Could not connect to HostGator SFTP server", err);
  }
  return sftp;
}

async function ensureDir(sftp: SftpClient, remoteDir: string): Promise<void> {
  try {
    const exists = await sftp.exists(remoteDir);
    if (exists === false) {
      await sftp.mkdir(remoteDir, true);
    }
  } catch (err) {
    throw new HostgatorStorageError(`Could not ensure remote directory ${remoteDir}`, err);
  }
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-180);
}

/**
 * Upload a file buffer to HostGator under {ROOT}/{ownerType}/{ownerId}/{timestamp}-{filename}.
 * Returns the absolute remote path stored in the DB.
 */
export async function uploadBuffer(opts: {
  ownerType: string;
  ownerId: number;
  originalName: string;
  buffer: Buffer;
}): Promise<{ storagePath: string }> {
  assertConfigured();
  const root = ROOT_DIR as string;
  const safeOwnerType = opts.ownerType.replace(/[^a-zA-Z0-9_-]/g, "_");
  const folder = path.posix.join(root, safeOwnerType, String(opts.ownerId));
  const filename = `${Date.now()}-${sanitizeName(opts.originalName)}`;
  const remotePath = path.posix.join(folder, filename);

  const sftp = await connect();
  try {
    await ensureDir(sftp, root);
    await ensureDir(sftp, path.posix.join(root, safeOwnerType));
    await ensureDir(sftp, folder);
    await sftp.put(opts.buffer, remotePath);
    return { storagePath: remotePath };
  } catch (err) {
    if (err instanceof HostgatorStorageError) throw err;
    throw new HostgatorStorageError("SFTP upload failed", err);
  } finally {
    await sftp.end().catch(() => {});
  }
}

/**
 * Stream a file from HostGator. Caller pipes the returned Readable to the response.
 */
export async function downloadStream(
  storagePath: string
): Promise<{ stream: Readable; cleanup: () => Promise<void> }> {
  assertConfigured();
  if (!storagePath.startsWith(ROOT_DIR as string)) {
    throw new HostgatorStorageError("Refusing to read file outside upload root");
  }
  const sftp = await connect();
  try {
    const buffer = (await sftp.get(storagePath)) as Buffer;
    const stream = Readable.from(buffer);
    return {
      stream,
      cleanup: async () => {
        await sftp.end().catch(() => {});
      },
    };
  } catch (err) {
    await sftp.end().catch(() => {});
    if (err instanceof HostgatorStorageError) throw err;
    throw new HostgatorStorageError("SFTP download failed", err);
  }
}

export async function deleteFile(storagePath: string): Promise<void> {
  assertConfigured();
  if (!storagePath.startsWith(ROOT_DIR as string)) {
    throw new HostgatorStorageError("Refusing to delete file outside upload root");
  }
  const sftp = await connect();
  try {
    const exists = await sftp.exists(storagePath);
    if (exists !== false) {
      await sftp.delete(storagePath);
    }
  } catch (err) {
    if (err instanceof HostgatorStorageError) throw err;
    throw new HostgatorStorageError("SFTP delete failed", err);
  } finally {
    await sftp.end().catch(() => {});
  }
}
