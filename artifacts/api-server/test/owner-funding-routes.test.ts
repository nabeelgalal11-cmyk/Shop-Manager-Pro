import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import type { Server } from "node:http";
import { db, pool, employeesTable, ownerFundingEntriesTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import app from "../src/app.ts";

const prefix = `__owner_funding_delete_test_${process.pid}_${Date.now()}__`;
const password = `${prefix}password`;
let server: Server;
let base: string;
let adminUsername: string;
let restrictedUsername: string;
let entryId: number;

async function request(path: string, init: RequestInit = {}, cookie?: string) {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  return fetch(`${base}${path}`, { ...init, headers });
}

async function login(username: string) {
  const response = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  assert.equal(response.status, 200);
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie);
  return setCookie.split(";")[0];
}

async function cleanup() {
  await db.delete(ownerFundingEntriesTable).where(
    sql`left(${ownerFundingEntriesTable.description}, length(${prefix})) = ${prefix}`,
  );
  await db.delete(employeesTable).where(
    sql`left(${employeesTable.lastName}, length(${prefix})) = ${prefix}`,
  );
}

before(async () => {
  await cleanup();
  const passwordHash = await bcrypt.hash(password, 4);
  adminUsername = `${prefix}admin`.toLowerCase();
  restrictedUsername = `${prefix}restricted`.toLowerCase();
  const users = await db.insert(employeesTable).values([
    {
      firstName: "Owner Funding",
      lastName: `${prefix}admin`,
      username: adminUsername,
      passwordHash,
      role: "admin",
      roles: ["admin"],
      active: true,
    },
    {
      firstName: "Owner Funding",
      lastName: `${prefix}restricted`,
      username: restrictedUsername,
      passwordHash,
      role: `${prefix}restricted`,
      roles: [`${prefix}restricted`],
      active: true,
    },
  ]).returning({ id: employeesTable.id, username: employeesTable.username });
  const admin = users.find((user) => user.username === adminUsername);
  assert.ok(admin);

  const [entry] = await db.insert(ownerFundingEntriesTable).values({
    type: "loan",
    amount: "100.00",
    entryDate: "2026-10-03",
    description: `${prefix}mistaken entry`,
    createdById: admin.id,
  }).returning({ id: ownerFundingEntriesTable.id });
  entryId = entry.id;

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      base = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  await cleanup();
  await pool.end();
});

test("owner funding deletion requires the expenses delete permission", async () => {
  assert.equal(
    (await request(`/api/owner-funding/${entryId}`, { method: "DELETE" })).status,
    401,
  );

  const restricted = await login(restrictedUsername);
  const denied = await request(`/api/owner-funding/${entryId}`, { method: "DELETE" }, restricted);
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), {
    error: "Forbidden",
    resource: "expenses",
    action: "delete",
  });

  const [stillExists] = await db.select({ id: ownerFundingEntriesTable.id })
    .from(ownerFundingEntriesTable)
    .where(sql`${ownerFundingEntriesTable.id} = ${entryId}`);
  assert.ok(stillExists);
});

test("an admin can delete an entry and repeated deletes return not found", async () => {
  const admin = await login(adminUsername);
  const invalid = await request("/api/owner-funding/not-an-id", { method: "DELETE" }, admin);
  assert.equal(invalid.status, 400);

  const deleted = await request(`/api/owner-funding/${entryId}`, { method: "DELETE" }, admin);
  assert.equal(deleted.status, 204);
  assert.equal(await deleted.text(), "");

  const [missing] = await db.select({ id: ownerFundingEntriesTable.id })
    .from(ownerFundingEntriesTable)
    .where(sql`${ownerFundingEntriesTable.id} = ${entryId}`);
  assert.equal(missing, undefined);

  const repeated = await request(`/api/owner-funding/${entryId}`, { method: "DELETE" }, admin);
  assert.equal(repeated.status, 404);
});