import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import type { Server } from "node:http";
import { db, pool, employeesTable, inventoryTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import app from "../src/app.ts";

const prefix = `__inventory_create_test_${process.pid}_${Date.now()}__`;
const password = `${prefix}password`;
let server: Server;
let base: string;
let adminUsername: string;
let restrictedUsername: string;

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
  await db.delete(inventoryTable).where(
    sql`left(${inventoryTable.name}, length(${prefix})) = ${prefix}`,
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
  await db.insert(employeesTable).values([
    {
      firstName: "Inventory",
      lastName: `${prefix}admin`,
      username: adminUsername,
      passwordHash,
      role: "admin",
      roles: ["admin"],
      active: true,
    },
    {
      firstName: "Inventory",
      lastName: `${prefix}restricted`,
      username: restrictedUsername,
      passwordHash,
      role: `${prefix}restricted`,
      roles: [`${prefix}restricted`],
      active: true,
    },
  ]);
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
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await cleanup();
  // This test shares the workspace database pool with the API package.
  await pool.end();
});

test("inventory create requires authentication and create permission", async () => {
  const body = JSON.stringify({ name: `${prefix}part`, category: "Test", quantity: 0, costPrice: 1 });
  assert.equal((await request("/api/inventory", { method: "POST", body })).status, 401);

  const restricted = await login(restrictedUsername);
  const denied = await request("/api/inventory", { method: "POST", body }, restricted);
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), {
    error: "Forbidden",
    resource: "inventory",
    action: "create",
  });
});

test("authenticated staff can create an inventory item with compatible vehicle fitment", async () => {
  const admin = await login(adminUsername);
  const response = await request(
    "/api/inventory",
    {
      method: "POST",
      body: JSON.stringify({
        name: `${prefix}fitment part`,
        category: "Test",
        costPrice: 12.5,
        sellPrice: 19.99,
        quantity: 0,
        minQuantity: 1,
        compatibleVehicles: "Honda Accord 2015-2022",
      }),
    },
    admin,
  );

  assert.equal(response.status, 201);
  const item = await response.json() as { name: string; compatibleVehicles: string };
  assert.equal(item.name, `${prefix}fitment part`);
  assert.equal(item.compatibleVehicles, "Honda Accord 2015-2022");
});

test("database failures return a readable JSON error instead of an empty success state", async () => {
  const admin = await login(adminUsername);
  const response = await request(
    "/api/inventory",
    {
      method: "POST",
      body: JSON.stringify({
        name: null,
        category: "Test",
        costPrice: 1,
        quantity: 0,
      }),
    },
    admin,
  );

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "The inventory item could not be saved. Please try again.",
  });
});