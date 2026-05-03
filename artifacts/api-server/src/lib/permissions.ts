import { db } from "@workspace/db";
import { rolePermissionsTable, employeesTable } from "@workspace/db";
import bcrypt from "bcryptjs";
import { sql, inArray } from "drizzle-orm";
import { logger } from "./logger.js";

export const RESOURCES = [
  "dashboard",
  "repair_orders",
  "estimates",
  "invoices",
  "appointments",
  "inspections",
  "njmvc",
  "njmvc_template",
  "customers",
  "vehicles",
  "inventory",
  "payments",
  "used_cars",
  "purchases",
  "suppliers",
  "reports",
  "employees",
  "time_entries",
  "expenses",
  "reminders",
  "customer_categories",
  "canned_jobs",
  "users",
  "permissions",
] as const;
export type Resource = (typeof RESOURCES)[number];

export const ACTIONS = ["view", "create", "edit", "delete", "print"] as const;
export type Action = (typeof ACTIONS)[number];

export const ROLES = ["admin", "manager", "technician", "inspector", "viewer"] as const;
export type Role = (typeof ROLES)[number];

const ALL: Action[] = ["view", "create", "edit", "delete", "print"];
const VIEW_ONLY: Action[] = ["view"];
const VIEW_PRINT: Action[] = ["view", "print"];
const VIEW_EDIT: Action[] = ["view", "edit"];
const VIEW_EDIT_CREATE: Action[] = ["view", "create", "edit"];
const VIEW_EDIT_CREATE_PRINT: Action[] = ["view", "create", "edit", "print"];
const NONE: Action[] = [];

type RoleMatrix = Record<Role, Partial<Record<Resource, Action[]>>>;

const DEFAULTS: RoleMatrix = {
  admin: Object.fromEntries(RESOURCES.map((r) => [r, ALL])) as Record<Resource, Action[]>,

  manager: {
    dashboard: VIEW_ONLY,
    repair_orders: ALL,
    estimates: ALL,
    invoices: ALL,
    appointments: ALL,
    inspections: ALL,
    njmvc: ALL,
    njmvc_template: VIEW_EDIT,
    customers: ALL,
    vehicles: ALL,
    inventory: ALL,
    payments: ALL,
    used_cars: ALL,
    purchases: ALL,
    suppliers: ALL,
    reports: VIEW_PRINT,
    employees: VIEW_EDIT_CREATE,
    time_entries: VIEW_EDIT_CREATE,
    expenses: VIEW_EDIT_CREATE,
    reminders: VIEW_EDIT_CREATE,
    customer_categories: VIEW_EDIT_CREATE,
    canned_jobs: ALL,
    users: VIEW_ONLY,
    permissions: VIEW_ONLY,
  },

  technician: {
    dashboard: VIEW_ONLY,
    repair_orders: VIEW_EDIT_CREATE_PRINT,
    estimates: VIEW_ONLY,
    invoices: VIEW_ONLY,
    appointments: VIEW_ONLY,
    inspections: VIEW_EDIT_CREATE,
    njmvc: VIEW_EDIT_CREATE_PRINT,
    njmvc_template: VIEW_ONLY,
    customers: VIEW_ONLY,
    vehicles: VIEW_ONLY,
    inventory: VIEW_EDIT,
    payments: NONE,
    used_cars: NONE,
    purchases: NONE,
    suppliers: VIEW_ONLY,
    reports: NONE,
    employees: NONE,
    time_entries: VIEW_EDIT_CREATE,
    expenses: VIEW_ONLY,
    reminders: VIEW_ONLY,
    customer_categories: NONE,
    canned_jobs: VIEW_ONLY,
    users: NONE,
    permissions: NONE,
  },

  inspector: {
    dashboard: VIEW_ONLY,
    repair_orders: VIEW_ONLY,
    estimates: NONE,
    invoices: NONE,
    appointments: VIEW_ONLY,
    inspections: VIEW_EDIT_CREATE_PRINT,
    njmvc: VIEW_EDIT_CREATE_PRINT,
    njmvc_template: VIEW_ONLY,
    customers: VIEW_ONLY,
    vehicles: VIEW_ONLY,
    inventory: NONE,
    payments: NONE,
    used_cars: NONE,
    purchases: NONE,
    suppliers: NONE,
    reports: NONE,
    employees: NONE,
    time_entries: VIEW_EDIT,
    expenses: NONE,
    reminders: VIEW_ONLY,
    customer_categories: NONE,
    canned_jobs: VIEW_ONLY,
    users: NONE,
    permissions: NONE,
  },

  viewer: {
    dashboard: VIEW_ONLY,
    repair_orders: VIEW_ONLY,
    estimates: VIEW_ONLY,
    invoices: VIEW_ONLY,
    appointments: VIEW_ONLY,
    inspections: VIEW_ONLY,
    njmvc: VIEW_ONLY,
    njmvc_template: NONE,
    customers: VIEW_ONLY,
    vehicles: VIEW_ONLY,
    inventory: VIEW_ONLY,
    payments: NONE,
    used_cars: NONE,
    purchases: NONE,
    suppliers: NONE,
    reports: NONE,
    employees: NONE,
    time_entries: NONE,
    expenses: NONE,
    reminders: VIEW_ONLY,
    customer_categories: NONE,
    canned_jobs: VIEW_ONLY,
    users: NONE,
    permissions: NONE,
  },
};

export async function seedDefaultPermissions(): Promise<void> {
  const existing = await db.select().from(rolePermissionsTable).limit(1);
  if (existing.length > 0) {
    logger.info("role_permissions already seeded; skipping defaults");
    return;
  }
  const rows: { role: string; resource: string; action: string }[] = [];
  for (const role of ROLES) {
    const matrix = DEFAULTS[role];
    for (const resource of RESOURCES) {
      const actions = matrix[resource] || NONE;
      for (const action of actions) {
        rows.push({ role, resource, action });
      }
    }
  }
  if (rows.length > 0) {
    await db.insert(rolePermissionsTable).values(rows);
    logger.info({ count: rows.length }, "Seeded default role permissions");
  }
}

export async function bootstrapAdmin(): Promise<void> {
  const anyUser = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(sql`${employeesTable.username} IS NOT NULL`)
    .limit(1);

  if (anyUser.length > 0) return;

  const username = "admin";
  const password = "admin123";
  const passwordHash = await bcrypt.hash(password, 10);

  await db
    .insert(employeesTable)
    .values({
      firstName: "Admin",
      lastName: "User",
      role: "admin",
      roles: ["admin"],
      active: true,
      username,
      passwordHash,
    })
    .onConflictDoNothing();

  logger.warn(
    { username },
    "Bootstrapped initial admin user with default password — CHANGE IT IMMEDIATELY via the Users page",
  );
}

export async function getPermissionsForRoles(
  roles: string[],
): Promise<Set<string>> {
  if (roles.length === 0) return new Set();
  const rows = await db
    .select({ resource: rolePermissionsTable.resource, action: rolePermissionsTable.action })
    .from(rolePermissionsTable)
    .where(inArray(rolePermissionsTable.role, roles));
  return new Set(rows.map((r) => `${r.resource}:${r.action}`));
}

export function hasPermission(
  perms: Set<string>,
  resource: Resource,
  action: Action,
): boolean {
  return perms.has(`${resource}:${action}`);
}
