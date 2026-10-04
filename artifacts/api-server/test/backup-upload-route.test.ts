import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { createBackupUploadHandler } from "../src/routes/backup-upload.js";

const TEST_TOKEN = "a".repeat(64);

test("backup receiver rejects missing credentials and unsafe filenames", async () => {
  const previousToken = process.env.BACKUP_UPLOAD_TOKEN;
  process.env.BACKUP_UPLOAD_TOKEN = TEST_TOKEN;

  const app = express();
  app.post("/api/backups/upload", createBackupUploadHandler());
  const server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/api/backups/upload`;

    const unauthenticated = await fetch(url, {
      method: "POST",
      body: "not a database backup",
    });
    assert.equal(unauthenticated.status, 401);
    assert.deepEqual(await unauthenticated.json(), { error: "Unauthorized." });

    const unsafeName = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        "X-Backup-Filename": "../../etc/passwd",
      },
      body: "not a database backup",
    });
    assert.equal(unsafeName.status, 400);
    assert.deepEqual(await unsafeName.json(), { error: "Invalid backup filename." });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (previousToken === undefined) {
      delete process.env.BACKUP_UPLOAD_TOKEN;
    } else {
      process.env.BACKUP_UPLOAD_TOKEN = previousToken;
    }
  }
});

test("backup source is determined by its credential, not a caller-provided header", async () => {
  const previousRenderToken = process.env.BACKUP_UPLOAD_TOKEN;
  const previousGithubActionsToken =
    process.env.GITHUB_ACTIONS_BACKUP_UPLOAD_TOKEN;
  const renderToken = "r".repeat(64);
  const githubActionsToken = "g".repeat(64);
  process.env.BACKUP_UPLOAD_TOKEN = renderToken;
  process.env.GITHUB_ACTIONS_BACKUP_UPLOAD_TOKEN = githubActionsToken;

  const uploads: Array<{ source: string; sha256: string }> = [];
  const handler = createBackupUploadHandler(async (input) => {
    uploads.push({ source: input.source, sha256: input.sha256 });
    return {
      fileId: `drive-${uploads.length}`,
      fileName: input.fileName,
      sizeBytes: input.sizeBytes,
      alreadyUploaded: false,
    };
  });
  const app = express();
  app.post("/api/backups/upload", handler);
  const server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/api/backups/upload`;
    const content = Buffer.from("verified backup bytes");
    const sha256 = createHash("sha256").update(content).digest("hex");
    const commonHeaders = {
      "Content-Type": "application/octet-stream",
      "X-Backup-Filename": "915motors-production-20260929T060000Z.dump",
      "X-Backup-SHA256": sha256,
    };

    const rejectedChecksum = await fetch(url, {
      method: "POST",
      headers: {
        ...commonHeaders,
        Authorization: `Bearer ${renderToken}`,
        "X-Backup-SHA256": "0".repeat(64),
      },
      body: content,
    });
    assert.equal(rejectedChecksum.status, 400);
    assert.deepEqual(await rejectedChecksum.json(), {
      error: "Backup checksum verification failed.",
    });

    const renderUpload = await fetch(url, {
      method: "POST",
      headers: {
        ...commonHeaders,
        Authorization: `Bearer ${renderToken}`,
        "X-Backup-Source": "github-actions",
      },
      body: content,
    });
    assert.equal(renderUpload.status, 201);

    const githubActionsUpload = await fetch(url, {
      method: "POST",
      headers: {
        ...commonHeaders,
        Authorization: `Bearer ${githubActionsToken}`,
        "X-Backup-Source": "render",
      },
      body: content,
    });
    assert.equal(githubActionsUpload.status, 201);

    assert.deepEqual(uploads, [
      { source: "render", sha256 },
      { source: "github-actions", sha256 },
    ]);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (previousRenderToken === undefined) {
      delete process.env.BACKUP_UPLOAD_TOKEN;
    } else {
      process.env.BACKUP_UPLOAD_TOKEN = previousRenderToken;
    }
    if (previousGithubActionsToken === undefined) {
      delete process.env.GITHUB_ACTIONS_BACKUP_UPLOAD_TOKEN;
    } else {
      process.env.GITHUB_ACTIONS_BACKUP_UPLOAD_TOKEN = previousGithubActionsToken;
    }
  }
});

test("backup receiver refuses ambiguous source tokens", async () => {
  const previousRenderToken = process.env.BACKUP_UPLOAD_TOKEN;
  const previousGithubActionsToken =
    process.env.GITHUB_ACTIONS_BACKUP_UPLOAD_TOKEN;
  process.env.BACKUP_UPLOAD_TOKEN = TEST_TOKEN;
  process.env.GITHUB_ACTIONS_BACKUP_UPLOAD_TOKEN = TEST_TOKEN;

  const app = express();
  app.post("/api/backups/upload", createBackupUploadHandler());
  const server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/backups/upload`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
        body: "backup",
      },
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "Backup upload is not configured.",
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (previousRenderToken === undefined) {
      delete process.env.BACKUP_UPLOAD_TOKEN;
    } else {
      process.env.BACKUP_UPLOAD_TOKEN = previousRenderToken;
    }
    if (previousGithubActionsToken === undefined) {
      delete process.env.GITHUB_ACTIONS_BACKUP_UPLOAD_TOKEN;
    } else {
      process.env.GITHUB_ACTIONS_BACKUP_UPLOAD_TOKEN =
        previousGithubActionsToken;
    }
  }
});