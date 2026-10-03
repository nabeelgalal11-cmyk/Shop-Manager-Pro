import { Router, type IRouter, type Request, type Response } from "express";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { pool } from "@workspace/db";
import { resolveDevelopmentBackupTarget } from "../lib/development-backup-target.js";
import { requireRole } from "../lib/auth.js";
import { isAllowedBackupUploadUrl } from "../lib/backup-upload-config.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
const MAX_BACKUP_BYTES = 2 * 1024 * 1024 * 1024;
const RESTORE_CONFIRMATION = "RESTORE DEVELOPMENT DATABASE";

function isRenderDeployment(): boolean {
  return process.env.RENDER === "true" || Boolean(process.env.RENDER_SERVICE_ID);
}

function databaseToolEnvironment(connectionString: string): NodeJS.ProcessEnv {
  const url = new URL(connectionString);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use PostgreSQL.");
  }
  const env = { ...process.env };
  env.PGHOST = url.hostname;
  env.PGPORT = url.port || "5432";
  env.PGUSER = decodeURIComponent(url.username);
  env.PGPASSWORD = decodeURIComponent(url.password);
  env.PGDATABASE = decodeURIComponent(url.pathname.replace(/^\//, ""));
  for (const [query, key] of [
    ["sslmode", "PGSSLMODE"],
    ["sslrootcert", "PGSSLROOTCERT"],
    ["sslcert", "PGSSLCERT"],
    ["sslkey", "PGSSLKEY"],
    ["channel_binding", "PGCHANNELBINDING"],
    ["application_name", "PGAPPNAME"],
  ]) {
    const value = url.searchParams.get(query);
    if (value) env[key] = value;
  }
  return env;
}

function runPgRestore(args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("pg_restore", args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout = `${stdout}${chunk}`.slice(-8000); });
    child.stderr.on("data", (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-4000); });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(
          `pg_restore exited ${signal ? `after ${signal}` : `with code ${code}`}${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
        ));
      }
    });
  });
}

function sendError(res: Response, status: number, message: string): void {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json({ error: message });
}

router.use(requireRole("admin"));

router.get("/development", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const { target } = resolveDevelopmentBackupTarget();
    res.json({
      enabled: true,
      environment: "development",
      target,
    });
  } catch (error) {
    res.json({
      enabled: false,
      reason: error instanceof Error
        ? error.message
        : "A separately configured and allowlisted test database is required.",
      target: null,
    });
  }
});

router.get("/production-status", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (process.env.NODE_ENV !== "production" && !isRenderDeployment()) {
    res.json({
      available: false,
      reason: "Production backup status is shown only by the production service.",
      configured: false,
      lastSuccessDate: null,
      lastAttemptAt: null,
      lastError: null,
    });
    return;
  }
  try {
    const result = await pool.query<{
      production_backup_success_date: string | null;
      production_backup_last_attempt_at: Date | null;
      production_backup_last_error: string | null;
    }>(
      `SELECT production_backup_success_date, production_backup_last_attempt_at, production_backup_last_error
       FROM shop_settings ORDER BY id LIMIT 1`,
    );
    const row = result.rows[0];
    const uploadUrl = process.env.BACKUP_UPLOAD_URL?.trim();
    const uploadToken = process.env.BACKUP_UPLOAD_TOKEN?.trim();
    res.json({
      available: true,
      configured: Boolean(
        process.env.DATABASE_URL &&
        uploadToken &&
        uploadToken.length >= 32 &&
        isAllowedBackupUploadUrl(uploadUrl),
      ),
      lastSuccessDate: row?.production_backup_success_date ?? null,
      lastAttemptAt: row?.production_backup_last_attempt_at?.toISOString() ?? null,
      lastError: row?.production_backup_last_error ?? null,
    });
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : "unknown error" },
      "Could not read production database backup status",
    );
    sendError(res, 503, "Production backup status is temporarily unavailable.");
  }
});

router.get("/development/download", async (_req, res) => {
  let destination: ReturnType<typeof resolveDevelopmentBackupTarget>;
  try {
    destination = resolveDevelopmentBackupTarget();
  } catch {
    sendError(res, 403, "A separate, allowlisted development restore endpoint is required.");
    return;
  }
  try {
    const directory = await mkdtemp(path.join(tmpdir(), "915motors-manual-backup-"));
    const filePath = path.join(directory, "development.dump");
    try {
      const child = spawn(
        "pg_dump",
        ["--format=custom", "--compress=6", "--no-owner", "--no-acl"],
        { env: databaseToolEnvironment(destination.connectionString), stdio: ["ignore", "pipe", "pipe"] },
      );
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-4000); });
      const output = createWriteStream(filePath, { flags: "wx", mode: 0o600 });
      let bytesWritten = 0;
      const sizeLimit = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytesWritten += chunk.length;
          if (bytesWritten > MAX_BACKUP_BYTES) {
            callback(new Error("Backup exceeds the 2 GiB download limit."));
            return;
          }
          callback(null, chunk);
        },
      });
      const dumpPromise = pipeline(child.stdout, sizeLimit, output).catch((error) => {
        child.kill("SIGTERM");
        throw error;
      });
      const exitPromise = new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => {
          if (code === 0) resolve();
          else reject(new Error(
            `pg_dump exited ${signal ? `after ${signal}` : `with code ${code}`}${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
          ));
        });
      });
      await Promise.all([dumpPromise, exitPromise]);
      const size = (await stat(filePath)).size;
      if (size <= 0 || size > MAX_BACKUP_BYTES) throw new Error("Backup archive size is invalid.");
      await runPgRestore(["--list", filePath], databaseToolEnvironment(destination.connectionString));

      const filename = `915motors-development-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}.dump`;
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Length", String(size));
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      await pipeline(createReadStream(filePath), res);
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : "unknown error" },
      "Development database backup failed",
    );
    if (!res.headersSent) sendError(res, 500, "Unable to create a development database backup.");
    else res.destroy();
  }
});

router.post("/development/restore", async (req: Request, res: Response) => {
  let destination: ReturnType<typeof resolveDevelopmentBackupTarget>;
  try {
    destination = resolveDevelopmentBackupTarget();
  } catch {
    sendError(res, 403, "A separate, allowlisted development restore endpoint is required.");
    return;
  }
  if (req.header("x-restore-confirmation") !== RESTORE_CONFIRMATION) {
    sendError(res, 400, `Type "${RESTORE_CONFIRMATION}" to confirm this development restore.`);
    return;
  }
  const fileName = req.header("x-backup-filename") ?? "";
  if (!/^[A-Za-z0-9._-]{1,180}\.dump$/i.test(fileName)) {
    sendError(res, 400, "Choose a PostgreSQL custom-format .dump archive.");
    return;
  }
  if (req.header("content-type")?.split(";")[0].trim() !== "application/octet-stream") {
    sendError(res, 415, "Content-Type must be application/octet-stream.");
    return;
  }
  const contentLength = Number(req.header("content-length"));
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
    sendError(res, 411, "A valid Content-Length is required.");
    return;
  }
  if (contentLength > MAX_BACKUP_BYTES) {
    sendError(res, 413, "Backup exceeds the 2 GiB restore limit.");
    return;
  }

  let bytesReceived = 0;
  try {
    const { target } = destination;
    const directory = await mkdtemp(path.join(tmpdir(), "915motors-restore-"));
    const filePath = path.join(directory, "uploaded.dump");
    const countAndLimit = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytesReceived += chunk.length;
        if (bytesReceived > MAX_BACKUP_BYTES) {
          callback(new Error("Backup exceeds the restore limit."));
          return;
        }
        callback(null, chunk);
      },
    });
    try {
      await pipeline(
        req,
        countAndLimit,
        createWriteStream(filePath, { flags: "wx", mode: 0o600 }),
      );
      if (bytesReceived !== contentLength) {
        sendError(res, 400, "Backup size did not match Content-Length.");
        return;
      }
      const restoreEnvironment = databaseToolEnvironment(destination.connectionString);
      const archiveEntries = await runPgRestore(["--list", filePath], restoreEnvironment);
      if (!archiveEntries.trim()) {
        sendError(res, 400, "The uploaded file does not contain a valid PostgreSQL archive.");
        return;
      }
      try {
        await runPgRestore(
          ["--exit-on-error", "--no-owner", "--no-acl", "--file=/dev/null", filePath],
          restoreEnvironment,
        );
      } catch {
        sendError(res, 400, "The uploaded file does not contain a valid PostgreSQL archive.");
        return;
      }
      await runPgRestore(
        [
          "--clean",
          "--if-exists",
          "--no-owner",
          "--no-acl",
          "--exit-on-error",
          "--dbname",
          target.database,
          filePath,
        ],
        restoreEnvironment,
      );
      logger.warn(
        { targetHost: target.host, targetDatabase: target.database, fileName },
        "Development database restored from uploaded backup",
      );
      res.setHeader("Cache-Control", "no-store");
      res.json({ ok: true, target, fileName });
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : "unknown error" },
      "Development database restore failed",
    );
    if (!res.headersSent && !res.destroyed) {
      if (bytesReceived !== contentLength || !req.complete) {
        sendError(res, 400, "Backup size did not match Content-Length.");
        return;
      }
      sendError(res, 400, "Restore failed. The development database may have been partially changed; review the error logs before retrying.");
    }
  }
});

export default router;