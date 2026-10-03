import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import backupsRouter from "../src/routes/backups.js";

const validArchive = Buffer.from("PGDMP test archive with complete data blocks");
const restoreDatabaseUrl =
  "postgresql://restore-user:fake-password@restore-test.neon.tech/restore_db?sslmode=require";
const applicationDatabaseUrl =
  "postgresql://app-user:fake-password@shop-main.neon.tech/shop_db?sslmode=require";

interface RequestOptions {
  body?: Buffer;
  contentLengthOverride?: number;
}

async function requestAsAdmin(
  path: string,
  env: Record<string, string | undefined>,
  headers: Record<string, string> = {},
  options: RequestOptions = {},
) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  const app = express();
  app.use((req, _res, next) => {
    (req as typeof req & { user?: { id: number; username: string; firstName: string; lastName: string; email: null; role: string; roles: string[]; active: boolean } }).user = {
      id: 1,
      username: "restore-test-admin",
      firstName: "Restore",
      lastName: "Test",
      email: null,
      role: "admin",
      roles: ["admin"],
      active: true,
    };
    if (options.contentLengthOverride !== undefined) {
      req.headers["content-length"] = String(options.contentLengthOverride);
    }
    next();
  });
  app.use("/api/backups", backupsRouter);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    return await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: "POST",
      headers,
      body: options.body,
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function createMockPgRestore() {
  const directory = await mkdtemp(path.join(tmpdir(), "915motors-test-pg-restore-"));
  const executablePath = path.join(directory, "pg_restore");
  const logPath = path.join(directory, "calls.log");
  const databaseStatePath = path.join(directory, "database-state.txt");
  const script = `#!${process.execPath}
import fs from "node:fs";

const args = process.argv.slice(2);
fs.appendFileSync(process.env.PGRESTORE_TEST_LOG, args.join(" ") + "\\n");
const archivePath = args.at(-1);

if (args.includes("--list")) {
  process.stdout.write("Archive TOC fixture entry\\n");
  process.exit(0);
}

const fileOptionIndex = args.findIndex((arg) => arg === "--file" || arg.startsWith("--file="));
if (fileOptionIndex !== -1) {
  const outputPath = args[fileOptionIndex] === "--file"
    ? args[fileOptionIndex + 1]
    : args[fileOptionIndex].slice("--file=".length);
  if (outputPath !== "/dev/null") process.exit(2);
  const archive = fs.readFileSync(archivePath);
  if (!archive.equals(Buffer.from(process.env.PGRESTORE_TEST_VALID_ARCHIVE))) {
    console.error("Archive data failed validation");
    process.exit(1);
  }
  process.exit(0);
}

if (args.includes("--dbname")) {
  fs.writeFileSync(process.env.PGRESTORE_TEST_DATABASE_STATE, "modified");
  process.exit(0);
}

process.exit(2);
`;
  await writeFile(executablePath, script, { mode: 0o700 });
  await chmod(executablePath, 0o700);
  await writeFile(logPath, "");
  await writeFile(databaseStatePath, "unchanged");
  return { directory, executablePath, logPath, databaseStatePath };
}

function mockRestoreEnvironment(mock: Awaited<ReturnType<typeof createMockPgRestore>>) {
  return {
    ...safeDevelopmentEnvironment,
    PATH: `${path.dirname(mock.executablePath)}${path.delimiter}${process.env.PATH ?? ""}`,
    PGRESTORE_TEST_LOG: mock.logPath,
    PGRESTORE_TEST_DATABASE_STATE: mock.databaseStatePath,
    PGRESTORE_TEST_VALID_ARCHIVE: validArchive.toString(),
  };
}

const restoreHeaders = {
  "content-type": "application/octet-stream",
  "x-backup-filename": "fixture.dump",
  "x-restore-confirmation": "RESTORE DEVELOPMENT DATABASE",
};

const safeDevelopmentEnvironment = {
  NODE_ENV: "development",
  RENDER: undefined,
  RENDER_SERVICE_ID: undefined,
  DATABASE_URL: applicationDatabaseUrl,
  DEVELOPMENT_RESTORE_DATABASE_URL: restoreDatabaseUrl,
  DEVELOPMENT_RESTORE_TARGET: "restore-test.neon.tech/restore_db",
};

test("restore route rejects production and Render environments before upload", async () => {
  const production = await requestAsAdmin(
    "/api/backups/development/restore",
    { ...safeDevelopmentEnvironment, NODE_ENV: "production" },
  );
  assert.equal(production.status, 403);

  const render = await requestAsAdmin(
    "/api/backups/development/restore",
    { ...safeDevelopmentEnvironment, RENDER_SERVICE_ID: "srv-test" },
  );
  assert.equal(render.status, 403);
});

test("restore route requires the exact confirmation text before accepting an upload", async () => {
  const response = await requestAsAdmin(
    "/api/backups/development/restore",
    safeDevelopmentEnvironment,
    {
      "content-type": "application/octet-stream",
      "x-backup-filename": "fixture.dump",
      "x-restore-confirmation": "RESTORE PRODUCTION DATABASE",
    },
  );

  assert.equal(response.status, 400);
  const body = await response.json() as { error: string };
  assert.match(body.error, /RESTORE DEVELOPMENT DATABASE/);
});

test("no production restore route is exposed", async () => {
  const response = await requestAsAdmin(
    "/api/backups/production/restore",
    safeDevelopmentEnvironment,
  );
  assert.equal(response.status, 404);
});

test("restore rejects corrupt and truncated archives before applying objects", async (t) => {
  const mock = await createMockPgRestore();
  try {
    const corruptArchive = Buffer.from(validArchive);
    corruptArchive[corruptArchive.length - 1] ^= 0xff;
    const truncatedArchive = validArchive.subarray(0, validArchive.length - 8);

    for (const [name, archive] of [
      ["corrupt", corruptArchive],
      ["truncated", truncatedArchive],
    ] as const) {
      await t.test(`${name} archive leaves the test database unchanged`, async () => {
        await writeFile(mock.logPath, "");
        await writeFile(mock.databaseStatePath, "unchanged");
        const response = await requestAsAdmin(
          "/api/backups/development/restore",
          mockRestoreEnvironment(mock),
          restoreHeaders,
          { body: archive },
        );

        assert.equal(response.status, 400);
        const body = await response.json() as { error: string };
        assert.match(body.error, /valid PostgreSQL archive/);
        assert.equal(await readFile(mock.databaseStatePath, "utf8"), "unchanged");

        const calls = await readFile(mock.logPath, "utf8");
        assert.match(calls, /--list/);
        assert.match(calls, /--file=\/dev\/null/);
        assert.doesNotMatch(calls, /--dbname/);
      });
    }
  } finally {
    await rm(mock.directory, { recursive: true, force: true });
  }
});

test("restore rejects a Content-Length mismatch without running pg_restore", async () => {
  const mock = await createMockPgRestore();
  try {
    const response = await requestAsAdmin(
      "/api/backups/development/restore",
      mockRestoreEnvironment(mock),
      restoreHeaders,
      {
        body: validArchive,
        contentLengthOverride: validArchive.length + 1,
      },
    );

    assert.equal(response.status, 400);
    const body = await response.json() as { error: string };
    assert.match(body.error, /did not match Content-Length/);
    assert.equal(await readFile(mock.databaseStatePath, "utf8"), "unchanged");
    assert.equal(await readFile(mock.logPath, "utf8"), "");
  } finally {
    await rm(mock.directory, { recursive: true, force: true });
  }
});