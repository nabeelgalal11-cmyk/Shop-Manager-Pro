import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import bcrypt from "bcryptjs";
import test, { after, before } from "node:test";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import {
  db,
  employeesTable,
  passwordResetTokensTable,
  pool,
} from "@workspace/db";
import type { SessionData } from "express-session";
import app from "../src/app.js";
import {
  PostgresLoginAttemptLimiter,
  PostgresSessionStore,
} from "../src/lib/auth-storage.js";

const apiServerRoot = process.cwd();
const workspaceRoot = path.resolve(apiServerRoot, "../..");
const prefix = `authsecurity${process.pid}${Date.now()}`;
const initialPassword = `${prefix}InitialPass`;
const newPassword = `${prefix}ChangedPass`;
const rateLimitIp = `${prefix}-rate-limit`;

let server: Server;
let baseUrl: string;
let changePasswordUserId: number;
let resetPasswordUserId: number;
let adminUserId: number;
let deactivateAccountUserId: number;
let deactivateEmployeeUserId: number;
let changePasswordUsername: string;
let resetPasswordUsername: string;
let adminUsername: string;
let deactivateAccountUsername: string;
let deactivateEmployeeUsername: string;

async function request(pathname: string, init: RequestInit = {}, cookie?: string) {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  return fetch(`${baseUrl}${pathname}`, { ...init, headers });
}

async function login(username: string, password = initialPassword, mobile = false) {
  const response = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password, mobile }),
  });
  assert.equal(response.status, 200, `login failed for ${username}`);
  const body = await response.json() as { mobileToken?: string };
  return {
    cookie: response.headers.get("set-cookie")?.split(";")[0] ?? null,
    mobileToken: body.mobileToken,
  };
}

async function createUser(username: string, role: string) {
  const passwordHash = await bcrypt.hash(initialPassword, 4);
  const [employee] = await db.insert(employeesTable).values({
    firstName: "Auth",
    lastName: role,
    username,
    passwordHash,
    role,
    roles: [role],
    active: true,
  }).returning({ id: employeesTable.id });
  return employee.id;
}

async function cleanup() {
  await pool.query(
    `DELETE FROM auth_sessions
     WHERE sess->>'userId' IN (
       SELECT id::text FROM employees WHERE username LIKE $1
     )`,
    [`${prefix}%`],
  );
  await pool.query("DELETE FROM auth_sessions WHERE sid LIKE $1", [`${prefix}%`]);
  await pool.query("DELETE FROM auth_login_attempts WHERE ip = $1", [rateLimitIp]);
  await pool.query(
    `DELETE FROM password_reset_tokens
     WHERE employee_id IN (
       SELECT id FROM employees WHERE username LIKE $1
     )`,
    [`${prefix}%`],
  );
  await pool.query("DELETE FROM employees WHERE username LIKE $1", [`${prefix}%`]);
}

async function assertNoStoredSessions(userId: number) {
  const { rows: [row] } = await pool.query(
    "SELECT count(*)::integer AS count FROM auth_sessions WHERE sess->>'userId' = $1",
    [String(userId)],
  );
  assert.equal(row.count, 0);
}

before(async () => {
  const migrationPath = path.join(workspaceRoot, "lib/db/migrations/2026-10-05_persistent_auth_storage.sql");
  await pool.query(await readFile(migrationPath, "utf8"));
  await cleanup();

  adminUsername = `${prefix}admin`;
  changePasswordUsername = `${prefix}change`;
  resetPasswordUsername = `${prefix}reset`;
  deactivateAccountUsername = `${prefix}deactivate-account`;
  deactivateEmployeeUsername = `${prefix}deactivate-employee`;
  [
    adminUserId,
    changePasswordUserId,
    resetPasswordUserId,
    deactivateAccountUserId,
    deactivateEmployeeUserId,
  ] = await Promise.all([
    createUser(adminUsername, "admin"),
    createUser(changePasswordUsername, "technician"),
    createUser(resetPasswordUsername, "technician"),
    createUser(deactivateAccountUsername, "technician"),
    createUser(deactivateEmployeeUsername, "technician"),
  ]);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  await cleanup();
});

test("stored sessions and login limits survive process restarts and are shared across instances", async () => {
  const store = new PostgresSessionStore();
  const sid = `${prefix}-persisted-session`;
  const stored: SessionData = {
    userId: 42,
    authVersion: 3,
    cookie: {
      originalMaxAge: 60_000,
      expires: new Date(Date.now() + 60_000),
      secure: false,
      httpOnly: true,
      path: "/",
    },
  };
  await new Promise<void>((resolve, reject) => {
    store.set(sid, stored, (error) => error ? reject(error) : resolve());
  });

  const storageModuleUrl = pathToFileURL(path.resolve(apiServerRoot, "src/lib/auth-storage.ts")).href;
  const restartProbe = `
    import { PostgresSessionStore } from ${JSON.stringify(storageModuleUrl)};
    const store = new PostgresSessionStore();
    store.get(${JSON.stringify(sid)}, (error, value) => {
      if (error) {
        console.error(String(error));
        process.exit(1);
      }
      process.stdout.write(JSON.stringify({
        userId: value?.userId,
        authVersion: value?.authVersion
      }));
      process.exit(0);
    });
  `;
  const afterRestart = execFileSync(process.execPath, [
    "--import", "tsx", "--input-type=module", "-e", restartProbe,
  ], {
    cwd: workspaceRoot,
    env: process.env,
    encoding: "utf8",
  }).trim();
  assert.deepEqual(JSON.parse(afterRestart), { userId: 42, authVersion: 3 });
  await new Promise<void>((resolve, reject) => {
    store.destroy(sid, (error) => error ? reject(error) : resolve());
  });

  const firstInstance = new PostgresLoginAttemptLimiter();
  const secondInstance = new PostgresLoginAttemptLimiter();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await (attempt % 2 ? firstInstance : secondInstance).reserve(rateLimitIp);
    assert.equal(result.allowed, true);
  }
  const afterRestartLimiter = new PostgresLoginAttemptLimiter();
  const blocked = await afterRestartLimiter.reserve(rateLimitIp);
  assert.equal(blocked.allowed, false);
  assert.ok((blocked.retryAfterSeconds ?? 0) > 0);
  await firstInstance.clear(rateLimitIp);
});

test("password changes and resets revoke existing cookie and mobile sessions", async () => {
  const changeSession = await login(changePasswordUsername);
  assert.ok(changeSession.cookie);
  assert.equal((await request("/api/auth/me", {}, changeSession.cookie)).status, 200);
  const changed = await request("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword: initialPassword, newPassword }),
  }, changeSession.cookie);
  assert.equal(changed.status, 200);
  await assertNoStoredSessions(changePasswordUserId);
  assert.equal((await request("/api/auth/me", {}, changeSession.cookie)).status, 401);

  const resetSession = await login(resetPasswordUsername, initialPassword, true);
  assert.ok(resetSession.cookie);
  assert.ok(resetSession.mobileToken);
  const rawToken = randomBytes(32).toString("hex");
  await db.insert(passwordResetTokensTable).values({
    employeeId: resetPasswordUserId,
    tokenHash: createHash("sha256").update(rawToken).digest("hex"),
    expiresAt: new Date(Date.now() + 60_000),
  });
  const reset = await request("/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token: rawToken, newPassword }),
  });
  assert.equal(reset.status, 200);
  await assertNoStoredSessions(resetPasswordUserId);
  assert.equal((await request("/api/auth/me", {}, resetSession.cookie)).status, 401);
  assert.equal((await request("/api/auth/me", {
    headers: { authorization: `Bearer ${resetSession.mobileToken}` },
  })).status, 401);
  assert.ok((await login(resetPasswordUsername, newPassword)).cookie);
});

test("both account deactivation routes revoke active sessions", async () => {
  const admin = await login(adminUsername);
  assert.ok(admin.cookie);

  const accountSession = await login(deactivateAccountUsername);
  assert.ok(accountSession.cookie);
  const deactivateAccount = await request(`/api/users/${deactivateAccountUserId}`, {
    method: "PUT",
    body: JSON.stringify({ active: false }),
  }, admin.cookie);
  assert.equal(deactivateAccount.status, 200);
  await assertNoStoredSessions(deactivateAccountUserId);
  assert.equal((await request("/api/auth/me", {}, accountSession.cookie)).status, 401);

  const employeeSession = await login(deactivateEmployeeUsername);
  assert.ok(employeeSession.cookie);
  const deactivateEmployee = await request(`/api/employees/${deactivateEmployeeUserId}`, {
    method: "PUT",
    body: JSON.stringify({ active: false }),
  }, admin.cookie);
  assert.equal(deactivateEmployee.status, 200);
  await assertNoStoredSessions(deactivateEmployeeUserId);
  assert.equal((await request("/api/auth/me", {}, employeeSession.cookie)).status, 401);

  const [stillAdmin] = await db.select({ id: employeesTable.id }).from(employeesTable)
    .where(eq(employeesTable.id, adminUserId));
  assert.equal(stillAdmin.id, adminUserId);
});
