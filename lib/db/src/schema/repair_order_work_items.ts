import { sql } from "drizzle-orm";
import { boolean, check, index, integer, numeric, pgEnum, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { estimateItemsTable } from "./estimate_items";
import { estimateItemKindEnum } from "./estimate_items";
import { employeesTable } from "./employees";
import { repairOrdersTable } from "./repair_orders";

export const workItemStatusEnum = pgEnum("repair_order_work_item_status", ["authorized", "performed", "void"]);
export const repairOrderWorkItemsTable = pgTable("repair_order_work_items", {
  id: serial("id").primaryKey(),
  repairOrderId: integer("repair_order_id").notNull().references(() => repairOrdersTable.id, { onDelete: "cascade" }),
  sourceEstimateItemId: integer("source_estimate_item_id").notNull().references(() => estimateItemsTable.id, { onDelete: "restrict" }),
  position: integer("position").notNull(),
  kind: estimateItemKindEnum("kind").notNull(),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
  unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull(),
  priceIncludesTax: boolean("price_includes_tax").notNull().default(false),
  unitCost: numeric("unit_cost", { precision: 14, scale: 2 }),
  estimatedHours: numeric("estimated_hours", { precision: 10, scale: 2 }),
  status: workItemStatusEnum("status").notNull().default("authorized"),
  authorizedAt: timestamp("authorized_at", { withTimezone: true }).notNull().defaultNow(),
  performedAt: timestamp("performed_at", { withTimezone: true }),
  performedById: integer("performed_by_id").references(() => employeesTable.id, { onDelete: "set null" }),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  voidReason: text("void_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("repair_order_work_items_source_unique").on(t.sourceEstimateItemId),
  uniqueIndex("repair_order_work_items_ro_position_unique").on(t.repairOrderId, t.position),
  index("repair_order_work_items_ro_status_idx").on(t.repairOrderId, t.status),
  check("repair_order_work_items_money_valid", sql`${t.quantity} > 0 AND ${t.unitPrice} >= 0 AND (${t.unitCost} IS NULL OR ${t.unitCost} >= 0) AND (${t.estimatedHours} IS NULL OR ${t.estimatedHours} >= 0)`),
]);

export type RepairOrderWorkItem = typeof repairOrderWorkItemsTable.$inferSelect;
export type InsertRepairOrderWorkItem = typeof repairOrderWorkItemsTable.$inferInsert;