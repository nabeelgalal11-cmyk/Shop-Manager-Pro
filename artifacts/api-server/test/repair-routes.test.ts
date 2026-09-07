import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import type { Server } from "node:http";
import {
  db, pool, customersTable, employeesTable, rolePermissionsTable, vehiclesTable,
} from "@workspace/db";
import app from "../src/app.ts";

const prefix = `__repair_route_test_${process.pid}_${Date.now()}__`;
const password = `${prefix}password`;
let server: Server;
let base: string;
let customerId: number;
let vehicleId: number;
let adminUsername: string;
let advisorUsername: string;

async function request(path: string, init: RequestInit = {}, cookie?: string) {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  return fetch(`${base}${path}`, { ...init, headers });
}

async function login(username: string) {
  const response = await request("/api/auth/login", {
    method: "POST", body: JSON.stringify({ username, password }),
  });
  assert.equal(response.status, 200);
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie);
  return setCookie.split(";")[0];
}

async function cleanup() {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("alter table repair_order_events disable trigger user");
    await client.query(
      "delete from repair_orders where customer_id in (select id from customers where last_name like $1)",
      [`${prefix}%`],
    );
    await client.query("alter table repair_order_events enable trigger user");
    await client.query("delete from vehicles where customer_id in (select id from customers where last_name like $1)", [`${prefix}%`]);
    await client.query("delete from customers where last_name like $1", [`${prefix}%`]);
    await client.query("delete from employees where last_name like $1", [`${prefix}%`]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

before(async () => {
  await cleanup();
  const passwordHash = await bcrypt.hash(password, 4);
  adminUsername = `${prefix}admin`.toLowerCase();
  advisorUsername = `${prefix}advisor`.toLowerCase();
  await db.insert(employeesTable).values([
    { firstName: "Route", lastName: `${prefix}admin`, username: adminUsername, passwordHash, role: "admin", roles: ["admin"], active: true },
    { firstName: "Route", lastName: `${prefix}advisor`, username: advisorUsername, passwordHash, role: "advisor", roles: ["advisor"], active: true },
  ]);
  await db.insert(rolePermissionsTable).values([
    { role: "advisor", resource: "estimates", action: "create" },
  ]).onConflictDoNothing();
  [customerId] = (await db.insert(customersTable).values({ firstName: "Route", lastName: `${prefix}customer` }).returning({ id: customersTable.id })).map((x) => x.id);
  [vehicleId] = (await db.insert(vehiclesTable).values({ customerId, year: 2020, make: "Route", model: "Fixture" }).returning({ id: vehiclesTable.id })).map((x) => x.id);
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
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await cleanup();
});

test("staff repair route rejects unauthenticated requests", async () => {
  assert.equal((await request("/api/repair-orders")).status, 401);
});

test("real auth session creates an RO and customer/vehicle mismatch is rejected by API", async () => {
  const cookie = await login(adminUsername);
  const created = await request("/api/repair-orders", {
    method: "POST", body: JSON.stringify({ customerId, vehicleId }),
  }, cookie);
  assert.equal(created.status, 201);

  const [other] = await db.insert(customersTable).values({ firstName: "Wrong", lastName: `${prefix}wrong` }).returning();
  const mismatch = await request("/api/repair-orders", {
    method: "POST", body: JSON.stringify({ customerId: other.id, vehicleId }),
  }, cookie);
  assert.equal(mismatch.status, 422);
});

test("advisor cannot create a revision on another advisor/admin aggregate", async () => {
  const admin = await login(adminUsername);
  const response = await request("/api/repair-orders", {
    method: "POST", body: JSON.stringify({ customerId, vehicleId }),
  }, admin);
  const ro = await response.json() as { id: number };
  const advisor = await login(advisorUsername);
  const denied = await request(`/api/repair-orders/${ro.id}/revisions`, {
    method: "POST", body: JSON.stringify({ kind: "estimate" }),
  }, advisor);
  assert.equal(denied.status, 403);
});