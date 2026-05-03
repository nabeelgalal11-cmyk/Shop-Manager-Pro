import SftpClient from "ssh2-sftp-client";
import { Readable } from "stream";
import path from "path";
import { logger } from "./logger.js";

const HOST = process.env.HOSTGATOR_SFTP_HOST;
const PORT = Number(process.env.HOSTGATOR_SFTP_PORT || "2222");
const USER = process.env.HOSTGATOR_SFTP_USER;
const PASSWORD = process.env.HOSTGATOR_SFTP_PASSWORD;
const PRIVATE_KEY = process.env.HOSTGATOR_SFTP_PRIVATE_KEY;
const PRIVATE_KEY_PASSPHRASE = process.env.HOSTGATOR_SFTP_PRIVATE_KEY_PASSPHRASE;
const ROOT_DIR = process.env.HOSTGATOR_UPLOAD_DIR;

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
          ...(PRIVATE_KEY_PASSPHRASE ? { passphrase: PRIVATE_KEY_PASSPHRASE } : {}),
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
