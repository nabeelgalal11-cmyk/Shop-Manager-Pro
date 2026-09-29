import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  uploadDatabaseBackupToDrive,
  type DriveProxy,
  type DriveProxyOptions,
} from "../src/lib/google-drive-backup.js";

const folderName = "915 Motors Database Backups";

function jsonResponse(value: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", ...Object.fromEntries(new Headers(headers)) },
  });
}

async function withBackupFile<T>(
  content: Buffer,
  callback: (filePath: string, sha256: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(path.join(tmpdir(), "backup-drive-test-"));
  const filePath = path.join(directory, "database.dump");
  await writeFile(filePath, content);
  try {
    return await callback(filePath, createHash("sha256").update(content).digest("hex"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("creates a private Drive folder and uploads a resumable backup", async () => {
  await withBackupFile(Buffer.from("test dump"), async (filePath, sha256) => {
    const calls: Array<{ path: string; options?: DriveProxyOptions }> = [];
    const proxy: DriveProxy = async (requestPath, options) => {
      calls.push({ path: requestPath, options });

      if (requestPath.startsWith("/drive/v3/files?") && options?.method !== "POST") {
        if (calls.length === 1) {
          return jsonResponse({ files: [] });
        }
        return jsonResponse({ files: [] });
      }

      if (requestPath.startsWith("/drive/v3/files?") && options?.method === "POST") {
        const body = JSON.parse(String(options.body));
        assert.equal(body.name, folderName);
        assert.equal(body.mimeType, "application/vnd.google-apps.folder");
        assert.equal(body.parents, undefined);
        return jsonResponse({ id: "folder-1", name: folderName, mimeType: body.mimeType });
      }

      if (
        requestPath.startsWith("/upload/drive/v3/files?") &&
        options?.method === "POST"
      ) {
        assert.equal(options?.method, "POST");
        const body = JSON.parse(String(options?.body));
        assert.equal(body.parents[0], "folder-1");
        assert.equal(body.appProperties.backupSha256, sha256);
        return new Response(null, {
          status: 200,
          headers: {
            Location:
              "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=test-session",
          },
        });
      }

      if (
        requestPath.startsWith("/upload/drive/v3/files?uploadType=resumable") &&
        options?.method === "PUT"
      ) {
        assert.equal(options?.method, "PUT");
        assert.equal(
          options?.headers?.["Content-Range"],
          `bytes 0-8/9`,
        );
        assert.deepEqual(Buffer.from(options?.body as Buffer), Buffer.from("test dump"));
        return jsonResponse({
          id: "drive-file-1",
          name: "915motors-production-20260929T060000Z.dump",
          size: "9",
          webViewLink: "https://drive.google.com/file/d/drive-file-1/view",
        }, 201);
      }

      throw new Error(`Unexpected Drive request: ${requestPath}`);
    };

    const result = await uploadDatabaseBackupToDrive({
      filePath,
      fileName: "915motors-production-20260929T060000Z.dump",
      sizeBytes: 9,
      sha256,
      proxy,
    });

    assert.equal(result.fileId, "drive-file-1");
    assert.equal(result.sizeBytes, 9);
    assert.equal(result.alreadyUploaded, false);
    assert.equal(calls.length, 5);
  });
});

test("treats an identical file already in the backup folder as an idempotent success", async () => {
  await withBackupFile(Buffer.from("saved dump"), async (filePath, sha256) => {
    let listCount = 0;
    const proxy: DriveProxy = async (requestPath) => {
      if (!requestPath.startsWith("/drive/v3/files?")) {
        throw new Error("An existing backup should not be uploaded again.");
      }
      listCount += 1;
      if (listCount === 1) {
        return jsonResponse({
          files: [{
            id: "folder-1",
            name: folderName,
            mimeType: "application/vnd.google-apps.folder",
          }],
        });
      }
      return jsonResponse({
        files: [{
          id: "drive-file-1",
          name: "915motors-production-20260929T060000Z.dump",
          size: String(Buffer.byteLength("saved dump")),
          appProperties: { backupSha256: sha256 },
        }],
      });
    };

    const result = await uploadDatabaseBackupToDrive({
      filePath,
      fileName: "915motors-production-20260929T060000Z.dump",
      sizeBytes: Buffer.byteLength("saved dump"),
      sha256,
      proxy,
    });

    assert.equal(result.fileId, "drive-file-1");
    assert.equal(result.alreadyUploaded, true);
    assert.equal(listCount, 2);
  });
});

test("continues only after Drive acknowledges each complete resumable chunk", async () => {
  const chunkSize = 8 * 1024 * 1024;
  await withBackupFile(
    Buffer.alloc(chunkSize + 3, 0x61),
    async (filePath, sha256) => {
      const putRanges: string[] = [];
      let listCount = 0;
      const proxy: DriveProxy = async (requestPath, options) => {
        if (requestPath.startsWith("/drive/v3/files?") && options?.method !== "POST") {
          listCount += 1;
          return listCount === 1
            ? jsonResponse({ files: [] })
            : jsonResponse({ files: [] });
        }
        if (requestPath.startsWith("/drive/v3/files?") && options?.method === "POST") {
          return jsonResponse({
            id: "folder-1",
            name: folderName,
            mimeType: "application/vnd.google-apps.folder",
          });
        }
        if (
          requestPath.startsWith("/upload/drive/v3/files?") &&
          options?.method === "POST"
        ) {
          return new Response(null, {
            status: 200,
            headers: {
              Location:
                "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=chunked-session",
            },
          });
        }
        if (
          requestPath.startsWith("/upload/drive/v3/files?uploadType=resumable") &&
          options?.method === "PUT"
        ) {
          const range = options.headers?.["Content-Range"];
          putRanges.push(range ?? "");
          if (putRanges.length === 1) {
            return new Response(null, {
              status: 308,
              headers: { Range: `bytes=0-${chunkSize - 1}` },
            });
          }
          return jsonResponse({
            id: "drive-file-chunked",
            name: "915motors-production-20260929T060000Z.dump",
            size: String(chunkSize + 3),
          }, 200);
        }
        throw new Error(`Unexpected Drive request: ${requestPath}`);
      };

      const result = await uploadDatabaseBackupToDrive({
        filePath,
        fileName: "915motors-production-20260929T060000Z.dump",
        sizeBytes: chunkSize + 3,
        sha256,
        proxy,
      });

      assert.deepEqual(putRanges, [
        `bytes 0-${chunkSize - 1}/${chunkSize + 3}`,
        `bytes ${chunkSize}-${chunkSize + 2}/${chunkSize + 3}`,
      ]);
      assert.equal(result.fileId, "drive-file-chunked");
    },
  );
});

test("rejects a same-name backup with different content", async () => {
  await withBackupFile(Buffer.from("new dump"), async (filePath, sha256) => {
    let listCount = 0;
    const proxy: DriveProxy = async (requestPath) => {
      if (!requestPath.startsWith("/drive/v3/files?")) {
        throw new Error("Conflicting backup should not be uploaded.");
      }
      listCount += 1;
      return listCount === 1
        ? jsonResponse({
          files: [{
            id: "folder-1",
            name: folderName,
            mimeType: "application/vnd.google-apps.folder",
          }],
        })
        : jsonResponse({
          files: [{
            id: "drive-file-1",
            name: "915motors-production-20260929T060000Z.dump",
            size: "3",
            appProperties: { backupSha256: "0".repeat(64) },
          }],
        });
    };

    await assert.rejects(
      uploadDatabaseBackupToDrive({
        filePath,
        fileName: "915motors-production-20260929T060000Z.dump",
        sizeBytes: Buffer.byteLength("new dump"),
        sha256,
        proxy,
      }),
      /different backup already exists/,
    );
  });
});