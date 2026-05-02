import { pgTable, serial, text, uniqueIndex } from "drizzle-orm/pg-core";

export const rolePermissionsTable = pgTable(
  "role_permissions",
  {
    id: serial("id").primaryKey(),
    role: text("role").notNull(),
    resource: text("resource").notNull(),
    action: text("action").notNull(),
  },
  (t) => ({
    uniq: uniqueIndex("role_permissions_role_resource_action_idx").on(t.role, t.resource, t.action),
  }),
);

export type RolePermission = typeof rolePermissionsTable.$inferSelect;
