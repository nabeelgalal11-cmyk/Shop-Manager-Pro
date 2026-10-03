import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable, Transform, type Writable } from "node:stream";
import { pool } from "@workspace/db";
import { isAllowedBackupUploadUrl } from "./backup-upload-config.js";
import { logger } from "./logger.js";

const BACKUP_LOCK_ID = 91520261001;
const BACKUP_LOCK_MS = 4 * 60 * 60 * 1000;
const MAX_BACKUP_BYTES = 2 * 1024 * 1024 * 1024;
const TIME_ZONE = "America/New_York";
let runningBackup: Promise<void> | null = null;
let lastAttemptAt = 0;
let lastAttemptDate: string | null = null;
let runningBackupDate: string | null = null;
let queuedBackupDate: string | null = null;
let configurationWarningShown = false;

interface BackupReservation {
  settingsId: number;
  lockToken: string;
  date: string;
}

function localBackupDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function backupFileName(now = new Date()): string {
  return `915motors-production-${now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}.dump`;
}

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production" || process.env.RENDER === "true" || Boolean(process.env.RENDER_SERVICE_ID);
}

function configuredUploadUrl(): string | null {
  const token = process.env.BACKUP_UPLOAD_TOKEN?.trim();
  const value = process.env.BACKUP_UPLOAD_URL?.trim();
  if (!token || token.length < 32 || !value || !isAllowedBackupUploadUrl(value)) return null;
  return value;
}

function databaseToolEnvironment(): NodeJS.ProcessEnv {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is missing.");

  const databaseUrl = new URL(connectionString);
  if (databaseUrl.protocol !== "postgres:" && databaseUrl.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use PostgreSQL.");
  }

  const env = { ...process.env };
  env.PGHOST = databaseUrl.hostname;
  env.PGPORT = databaseUrl.port || "5432";
  env.PGUSER = decodeURIComponent(databaseUrl.username);
  env.PGPASSWORD = decodeURIComponent(databaseUrl.password);
  env.PGDATABASE = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ""));

  const libpqOptions: Record<string, string> = {
    sslmode: "PGSSLMODE",
    sslrootcert: "PGSSLROOTCERT",
    sslcert: "PGSSLCERT",
    sslkey: "PGSSLKEY",
    channel_binding: "PGCHANNELBINDING",
    application_name: "PGAPPNAME",
  };
  for (const [queryKey, envKey] of Object.entries(libpqOptions)) {
    const value = databaseUrl.searchParams.get(queryKey);
    if (value) env[envKey] = value;
  }
  return env;
}

function runTool(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  stdout?: Writable,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", stdout ? "pipe" : "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-4000);
    });
    let pipelineError: unknown;
    let outputBytes = 0;
    const outputPromise = stdout && child.stdout
      ? pipeline(
          child.stdout,
          new Transform({
            transform(chunk: Buffer, _encoding, callback) {
              outputBytes += chunk.length;
              if (outputBytes > MAX_BACKUP_BYTES) {
                callback(new Error("Backup exceeds the 2 GiB upload limit."));
                return;
              }
              callback(null, chunk);
            },
          }),
          stdout,
        ).catch((error) => {
          pipelineError = error;
          child.kill("SIGTERM");
        })
      : Promise.resolve();
    child.once("error", reject);
    child.once("close", (code, signal) => {
      void outputPromise.then(() => {
        if (pipelineError) {
          reject(pipelineError);
        } else if (code === 0) {
          resolve();
        } else {
          reject(new Error(
            `${command} exited ${signal ? `after ${signal}` : `with code ${code}`}${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
          ));
        }
      });
    });
  });
}

async function createDump(filePath: string): Promise<number> {
  const output = createWriteStream(filePath, { flags: "wx", mode: 0o600 });
  await runTool(
    "pg_dump",
    ["--format=custom", "--compress=6", "--no-owner", "--no-acl"],
    databaseToolEnvironment(),
    output,
  );
  const size = (await stat(filePath)).size;
  if (size <= 0) throw new Error("pg_dump produced an empty archive.");
  if (size > MAX_BACKUP_BYTES) throw new Error("Backup exceeds the 2 GiB upload limit.");

  await runTool("pg_restore", ["--list", filePath], databaseToolEnvironment());
  return size;
}

async function sha256File(filePath: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) digest.update(chunk);
  return digest.digest("hex");
}

async function reserveDailyBackup(date: string): Promise<BackupReservation | null> {
  const client = await pool.connect();
  const lockToken = randomUUID();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [BACKUP_LOCK_ID]);
    const selected = await client.query<{
      id: number;
      production_backup_success_date: string | null;
      production_backup_lock_date: string | null;
      production_backup_lock_until: Date | null;
    }>(
      `SELECT id, production_backup_success_date, production_backup_lock_date, production_backup_lock_until
       FROM shop_settings ORDER BY id LIMIT 1 FOR UPDATE`,
    );
    let settings = selected.rows[0];
    if (!settings) {
      const inserted = await client.query<{ id: number }>(
        "INSERT INTO shop_settings DEFAULT VALUES RETURNING id",
      );
      settings = {
        id: inserted.rows[0].id,
        production_backup_success_date: null,
        production_backup_lock_date: null,
        production_backup_lock_until: null,
      };
    }

    if (settings.production_backup_success_date === date) {
      await client.query("COMMIT");
      return null;
    }
    if (
      settings.production_backup_lock_date === date &&
      settings.production_backup_lock_until &&
      new Date(settings.production_backup_lock_until).getTime() > Date.now()
    ) {
      await client.query("COMMIT");
      return null;
    }

    await client.query(
      `UPDATE shop_settings
       SET production_backup_lock_token = $1,
           production_backup_lock_date = $2::date,
           production_backup_lock_until = now() + ($3 * interval '1 millisecond')
       WHERE id = $4`,
      [lockToken, date, BACKUP_LOCK_MS, settings.id],
    );
    await client.query("COMMIT");
    return { settingsId: settings.id, lockToken, date };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function finishDailyBackup(reservation: BackupReservation, succeeded: boolean): Promise<void> {
  await pool.query(
    `UPDATE shop_settings
     SET production_backup_success_date = CASE WHEN $1 THEN $2::date ELSE production_backup_success_date END,
         production_backup_last_attempt_at = now(),
         production_backup_last_error = CASE WHEN $1 THEN NULL ELSE 'Backup creation or upload failed.' END,
         production_backup_lock_token = NULL,
         production_backup_lock_date = NULL,
         production_backup_lock_until = NULL
     WHERE id = $3 AND production_backup_lock_token = $4`,
    [succeeded, reservation.date, reservation.settingsId, reservation.lockToken],
  );
}

async function createAndUploadDailyBackup(date: string): Promise<void> {
  const uploadUrl = configuredUploadUrl();
  if (!isProductionRuntime() || !uploadUrl || !process.env.DATABASE_URL) return;

  const reservation = await reserveDailyBackup(date);
  if (!reservation) return;

  let directory: string | null = null;
  try {
    directory = await mkdtemp(path.join(tmpdir(), "915motors-daily-backup-"));
    const filePath = path.join(directory, "production.dump");
    const now = new Date();
    const fileName = backupFileName(now);
    const sizeBytes = await createDump(filePath);
    const sha256 = await sha256File(filePath);
    const token = process.env.BACKUP_UPLOAD_TOKEN!;

    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "Content-Length": String(sizeBytes),
        "X-Backup-Filename": fileName,
        "X-Backup-SHA256": sha256,
      },
      body: Readable.toWeb(createReadStream(filePath)) as BodyInit,
      signal: AbortSignal.timeout(60 * 60 * 1000),
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      throw new Error(`Backup relay returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    await response.arrayBuffer();
    await finishDailyBackup(reservation, true);
    logger.info({ fileName, sizeBytes }, "Daily production database backup completed");
  } catch (error) {
    await finishDailyBackup(reservation, false).catch((releaseError) => {
      logger.error({ err: releaseError }, "Could not release production backup lock");
    });
    logger.error(
      { err: error instanceof Error ? error.message : "unknown error" },
      "Daily production database backup failed",
    );
  } finally {
    if (directory) {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

export function queueDailyProductionBackup(): void {
  if (!isProductionRuntime()) return;
  if (!configuredUploadUrl() || !process.env.DATABASE_URL) {
    if (!configurationWarningShown) {
      configurationWarningShown = true;
      logger.warn(
        {
          databaseUrlSet: Boolean(process.env.DATABASE_URL),
          uploadTokenSet: Boolean(process.env.BACKUP_UPLOAD_TOKEN?.trim()),
          uploadUrlSet: Boolean(process.env.BACKUP_UPLOAD_URL?.trim()),
        },
        "Daily production backup is not configured; login will continue without waiting",
      );
    }
    return;
  }
  const date = localBackupDate();
  if (runningBackup) {
    if (runningBackupDate !== date) queuedBackupDate = date;
    return;
  }
  const now = Date.now();
  if (lastAttemptDate === date && now - lastAttemptAt < 10 * 60 * 1000) return;
  lastAttemptAt = now;
  lastAttemptDate = date;
  runningBackupDate = date;

  runningBackup = createAndUploadDailyBackup(date)
    .catch((error) => {
      logger.error(
        { err: error instanceof Error ? error.message : "unknown error" },
        "Could not start daily production database backup",
      );
    })
    .finally(() => {
      runningBackup = null;
      runningBackupDate = null;
      const shouldRunQueuedDate = queuedBackupDate === localBackupDate();
      queuedBackupDate = null;
      if (shouldRunQueuedDate) queueDailyProductionBackup();
    });
}