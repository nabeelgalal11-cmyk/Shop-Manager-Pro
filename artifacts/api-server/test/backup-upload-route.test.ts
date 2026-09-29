import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { handleBackupUpload } from "../src/routes/backup-upload.js";

const TEST_TOKEN = "a".repeat(64);

test("backup receiver rejects missing credentials and unsafe filenames", async () => {
  const previousToken = process.env.BACKUP_UPLOAD_TOKEN;
  process.env.BACKUP_UPLOAD_TOKEN = TEST_TOKEN;

  const app = express();
  app.post("/api/backups/upload", handleBackupUpload);
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