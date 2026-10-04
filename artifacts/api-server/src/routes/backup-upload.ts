import { createHash, timingSafeEqual } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Request, Response } from "express";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "../lib/logger.js";
import {
  uploadDatabaseBackupToDrive,
  type DriveBackupSource,
} from "../lib/google-drive-backup.js";

const MAX_BACKUP_BYTES = 2 * 1024 * 1024 * 1024;
const FILE_NAME_PATTERN =
  /^915motors-production-\d{8}T\d{6}Z\.dump$/;

class BackupTooLargeError extends Error {}

export function isValidBackupFileName(fileName: string): boolean {
  return FILE_NAME_PATTERN.test(fileName);
}

type BackupUploadFunction = typeof uploadDatabaseBackupToDrive;

function matchesBearerToken(
  authorization: string | undefined,
  expectedToken: string,
): boolean {
  if (!authorization) {
    return false;
  }

  const expected = Buffer.from(`Bearer ${expectedToken}`);
  const actual = Buffer.from(authorization);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function sendError(res: Response, status: number, message: string): void {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json({ error: message });
}

export function createBackupUploadHandler(
  uploadBackup: BackupUploadFunction = uploadDatabaseBackupToDrive,
) {
  return async function handleBackupUpload(
    req: Request,
    res: Response,
  ): Promise<void> {
    res.setHeader("Cache-Control", "no-store");

    const renderToken = process.env.BACKUP_UPLOAD_TOKEN?.trim() || null;
    const githubActionsToken =
      process.env.GITHUB_ACTIONS_BACKUP_UPLOAD_TOKEN?.trim() || null;
    const configuredTokens = [renderToken, githubActionsToken].filter(
      (token): token is string => token !== null,
    );

    if (
      configuredTokens.length === 0 ||
      configuredTokens.some((token) => token.length < 32) ||
      (renderToken !== null && renderToken === githubActionsToken)
    ) {
      sendError(res, 503, "Backup upload is not configured.");
      return;
    }

    let source: DriveBackupSource | null = null;
    if (renderToken && matchesBearerToken(req.header("authorization"), renderToken)) {
      source = "render";
    }
    if (
      githubActionsToken &&
      matchesBearerToken(req.header("authorization"), githubActionsToken)
    ) {
      if (source) {
        sendError(res, 503, "Backup upload is not configured.");
        return;
      }
      source = "github-actions";
    }
    if (!source) {
      sendError(res, 401, "Unauthorized.");
      return;
    }

    const fileName = req.header("x-backup-filename") ?? "";
    if (!isValidBackupFileName(fileName)) {
      sendError(res, 400, "Invalid backup filename.");
      return;
    }

    const contentLength = Number(req.header("content-length"));
    if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
      sendError(res, 411, "A valid Content-Length is required.");
      return;
    }
    if (contentLength > MAX_BACKUP_BYTES) {
      sendError(res, 413, "Backup exceeds the 2 GiB upload limit.");
      return;
    }

    const expectedSha = (req.header("x-backup-sha256") ?? "").toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expectedSha)) {
      sendError(res, 400, "A valid backup SHA-256 checksum is required.");
      return;
    }
    if (req.header("content-type")?.split(";")[0].trim() !== "application/octet-stream") {
      sendError(res, 415, "Content-Type must be application/octet-stream.");
      return;
    }

    const tempDirectory = await mkdtemp(path.join(tmpdir(), "915motors-backup-"));
    const filePath = path.join(tempDirectory, "database.dump");
    const digest = createHash("sha256");
    let bytesReceived = 0;
    const hashAndLimit = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytesReceived += chunk.length;
        if (bytesReceived > MAX_BACKUP_BYTES) {
          callback(new BackupTooLargeError("Backup exceeds the upload limit."));
          return;
        }
        digest.update(chunk);
        callback(null, chunk);
      },
    });

    try {
      await pipeline(
        req,
        hashAndLimit,
        createWriteStream(filePath, { flags: "wx", mode: 0o600 }),
      );

      if (bytesReceived !== contentLength) {
        sendError(res, 400, "Backup size did not match Content-Length.");
        return;
      }

      const actualSha = digest.digest("hex");
      const expectedShaBuffer = Buffer.from(expectedSha, "hex");
      const actualShaBuffer = Buffer.from(actualSha, "hex");
      if (!timingSafeEqual(expectedShaBuffer, actualShaBuffer)) {
        sendError(res, 400, "Backup checksum verification failed.");
        return;
      }

      const connectors = new ReplitConnectors();
      const result = await uploadBackup({
        filePath,
        fileName,
        sizeBytes: bytesReceived,
        sha256: actualSha,
        source,
        proxy: (apiPath, options) =>
          connectors.proxy("google-drive", apiPath, options),
      });

      logger.info(
        {
          fileName: result.fileName,
          sizeBytes: result.sizeBytes,
          alreadyUploaded: result.alreadyUploaded,
        },
        "Production database backup stored in Google Drive",
      );
      res.status(result.alreadyUploaded ? 200 : 201).json({
        ok: true,
        fileName: result.fileName,
        sizeBytes: result.sizeBytes,
        alreadyUploaded: result.alreadyUploaded,
      });
    } catch (error) {
      if (error instanceof BackupTooLargeError) {
        sendError(res, 413, "Backup exceeds the 2 GiB upload limit.");
        return;
      }
      logger.error(
        { message: error instanceof Error ? error.message : "unknown error" },
        "Production database backup upload failed",
      );
      if (!res.headersSent && !req.destroyed) {
        sendError(res, 502, "Backup upload failed.");
      }
    } finally {
      await rm(tempDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  };
}

export const handleBackupUpload = createBackupUploadHandler();