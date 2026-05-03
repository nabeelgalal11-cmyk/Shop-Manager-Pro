import { Readable } from "stream";
import { logger } from "./logger.js";

/**
 * HostGator file storage via HTTPS gateway (a small PHP script running on the
 * user's HostGator account at <BASE_URL>/shopos-storage.php).
 *
 * We use HTTPS instead of SFTP because HostGator's firewall blocks ports
 * 21/22/2222 from cloud-hosted IPs but allows 443. Files are still stored on
 * the user's HostGator server in a folder OUTSIDE public_html — the PHP script
 * handles all filesystem access and requires X-Auth-Token on every request.
 */

const BASE_URL = (process.env.HOSTGATOR_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.HOSTGATOR_STORAGE_TOKEN;
const SCRIPT_PATH = "/shopos-storage.php";

export class HostgatorStorageError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "HostgatorStorageError";
  }
}

export function isConfigured(): boolean {
  return Boolean(BASE_URL && TOKEN);
}

function assertConfigured(): void {
  if (!isConfigured()) {
    throw new HostgatorStorageError(
      "HostGator storage is not configured. Set HOSTGATOR_PUBLIC_BASE_URL and HOSTGATOR_STORAGE_TOKEN."
    );
  }
}

function endpoint(action: string): string {
  return `${BASE_URL}${SCRIPT_PATH}?action=${encodeURIComponent(action)}`;
}

async function parseJsonOrThrow(res: Response, label: string): Promise<any> {
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // not JSON
  }
  if (!res.ok || (body && body.ok === false)) {
    const msg = body?.error || text?.slice(0, 200) || `HTTP ${res.status}`;
    throw new HostgatorStorageError(`${label} failed: ${msg}`);
  }
  return body;
}

/**
 * Upload a file buffer to HostGator. Returns the relative storage path the
 * gateway assigned (e.g. "owners/repair_order/12/1730000000-foo.png"), which
 * we persist in the DB and pass back on download/delete.
 */
export async function uploadBuffer(opts: {
  ownerType: string;
  ownerId: number;
  originalName: string;
  buffer: Buffer;
  mimeType?: string;
}): Promise<{ storagePath: string }> {
  assertConfigured();
  const form = new FormData();
  const blob = new Blob([new Uint8Array(opts.buffer)], {
    type: opts.mimeType || "application/octet-stream",
  });
  form.append("file", blob, opts.originalName);
  form.append("ownerType", opts.ownerType);
  form.append("ownerId", String(opts.ownerId));

  let res: Response;
  try {
    res = await fetch(endpoint("upload"), {
      method: "POST",
      headers: { "X-Auth-Token": TOKEN as string },
      body: form,
    });
  } catch (err) {
    logger.error({ err }, "[hostgatorStorage] upload network error");
    throw new HostgatorStorageError("Could not reach HostGator storage gateway", err);
  }
  const body = await parseJsonOrThrow(res, "upload");
  if (!body?.storagePath) {
    throw new HostgatorStorageError("upload response missing storagePath");
  }
  return { storagePath: body.storagePath as string };
}

/**
 * Stream a file back from HostGator. Caller pipes the returned Readable to
 * the response and must invoke cleanup() when done.
 */
export async function downloadStream(
  storagePath: string
): Promise<{ stream: Readable; cleanup: () => Promise<void> }> {
  assertConfigured();
  const url = `${endpoint("download")}&path=${encodeURIComponent(storagePath)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { "X-Auth-Token": TOKEN as string },
    });
  } catch (err) {
    logger.error({ err }, "[hostgatorStorage] download network error");
    throw new HostgatorStorageError("Could not reach HostGator storage gateway", err);
  }
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new HostgatorStorageError(
      `download failed: HTTP ${res.status} ${text.slice(0, 200)}`
    );
  }
  // Convert the Web ReadableStream from fetch into a Node Readable.
  const stream = Readable.fromWeb(res.body as any);
  return {
    stream,
    cleanup: async () => {
      // No persistent connection to close for fetch streams.
    },
  };
}

export async function deleteFile(storagePath: string): Promise<void> {
  assertConfigured();
  const form = new URLSearchParams({ path: storagePath });
  let res: Response;
  try {
    res = await fetch(endpoint("delete"), {
      method: "POST",
      headers: {
        "X-Auth-Token": TOKEN as string,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
  } catch (err) {
    logger.error({ err }, "[hostgatorStorage] delete network error");
    throw new HostgatorStorageError("Could not reach HostGator storage gateway", err);
  }
  await parseJsonOrThrow(res, "delete");
}
