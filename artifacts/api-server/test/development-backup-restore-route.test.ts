import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import backupsRouter from "../src/routes/backups.js";

const restoreDatabaseUrl =
  "postgresql://restore-user:fake-password@restore-test.neon.tech/restore_db?sslmode=require";
const applicationDatabaseUrl =
  "postgresql://app-user:fake-password@shop-main.neon.tech/shop_db?sslmode=require";

async function requestAsAdmin(
  path: string,
  env: Record<string, string | undefined>,
  headers: Record<string, string> = {},
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
      "content-length": "1",
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