import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgEnum, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { customersTable } from "./customers";
import { employeesTable } from "./employees";
import { usedCarsTable } from "./used_cars";
import { vehiclesTable } from "./vehicles";

export const repairOrderStatusEnum = pgEnum("repair_order_status", ["open", "diagnosing", "awaiting_approval", "authorized", "in_progress", "completed", "cancelled"]);
export const repairOrderPriorityEnum = pgEnum("repair_order_priority", ["low", "normal", "high", "urgent"]);

/** Aggregate root. `usedCarId` and `internal` are retained for used-car reconditioning compatibility. */
export const repairOrdersTable = pgTable("repair_orders", {
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").notNull().unique(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  vehicleId: integer("vehicle_id").notNull().references(() => vehiclesTable.id),
  usedCarId: integer("used_car_id").references(() => usedCarsTable.id, { onDelete: "set null" }),
  internal: boolean("internal").notNull().default(false),
  assignedToId: integer("assigned_to_id").references(() => employeesTable.id, { onDelete: "set null" }),
  createdById: integer("created_by_id").notNull().references(() => employeesTable.id),
  status: repairOrderStatusEnum("status").notNull().default("open"),
  priority: repairOrderPriorityEnum("priority").notNull().default("normal"),
  complaint: text("complaint"),
  diagnosis: text("diagnosis"),
  notes: text("notes"),
  mileageIn: integer("mileage_in"),
  mileageOut: integer("mileage_out"),
  promisedAt: timestamp("promised_at", { withTimezone: true }),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancellationReason: text("cancellation_reason"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("repair_orders_customer_idx").on(t.customerId),
  index("repair_orders_vehicle_idx").on(t.vehicleId),
  index("repair_orders_status_idx").on(t.status),
  check("repair_orders_version_positive", sql`${t.version} > 0`),
  check("repair_orders_mileage_order", sql`${t.mileageOut} IS NULL OR ${t.mileageIn} IS NULL OR ${t.mileageOut} >= ${t.mileageIn}`),
  check("repair_orders_terminal_metadata", sql`(${t.status} <> 'completed' OR ${t.completedAt} IS NOT NULL) AND (${t.status} <> 'cancelled' OR (${t.cancelledAt} IS NOT NULL AND ${t.cancellationReason} IS NOT NULL))`),
]);

export const insertRepairOrderSchema = createInsertSchema(repairOrdersTable).omit({ id: true, orderNumber: true, version: true, createdAt: true, updatedAt: true });
export type InsertRepairOrder = z.infer<typeof insertRepairOrderSchema>;
export type RepairOrder = typeof repairOrdersTable.$inferSelect;