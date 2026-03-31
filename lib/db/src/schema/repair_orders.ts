import { pgTable, serial, text, numeric, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { customersTable } from "./customers";
import { vehiclesTable } from "./vehicles";
import { employeesTable } from "./employees";

export const repairOrdersTable = pgTable("repair_orders", {
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").notNull().unique(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  vehicleId: integer("vehicle_id").notNull().references(() => vehiclesTable.id),
  assignedToId: integer("assigned_to_id").references(() => employeesTable.id),
  status: text("status").notNull().default("pending"),
  priority: text("priority").notNull().default("normal"),
  complaint: text("complaint"),
  diagnosis: text("diagnosis"),
  notes: text("notes"),
  parts: jsonb("parts").$type<Array<{ name: string; partNumber?: string; quantity: number; unitPrice: number }>>().default([]),
  estimatedHours: numeric("estimated_hours", { precision: 10, scale: 2 }),
  actualHours: numeric("actual_hours", { precision: 10, scale: 2 }),
  mileageIn: integer("mileage_in"),
  mileageOut: integer("mileage_out"),
  promisedDate: timestamp("promised_date"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertRepairOrderSchema = createInsertSchema(repairOrdersTable).omit({
  id: true,
  orderNumber: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertRepairOrder = z.infer<typeof insertRepairOrderSchema>;
export type RepairOrder = typeof repairOrdersTable.$inferSelect;
