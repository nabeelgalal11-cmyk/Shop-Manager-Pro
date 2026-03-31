import { pgTable, serial, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vehiclesTable } from "./vehicles";
import { repairOrdersTable } from "./repair_orders";
import { employeesTable } from "./employees";

export const inspectionsTable = pgTable("inspections", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").notNull().references(() => vehiclesTable.id),
  repairOrderId: integer("repair_order_id").references(() => repairOrdersTable.id),
  inspectedById: integer("inspected_by_id").references(() => employeesTable.id),
  type: text("type").notNull(),
  mileage: integer("mileage"),
  overallCondition: text("overall_condition").notNull().default("good"),
  items: jsonb("items").default([]),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertInspectionSchema = createInsertSchema(inspectionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertInspection = z.infer<typeof insertInspectionSchema>;
export type Inspection = typeof inspectionsTable.$inferSelect;
