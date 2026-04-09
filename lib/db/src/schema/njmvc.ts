import { pgTable, serial, text, integer, boolean, timestamp, date } from "drizzle-orm/pg-core";
import { vehiclesTable } from "./vehicles";

export const njmvcCategoriesTable = pgTable("njmvc_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const njmvcItemsTable = pgTable("njmvc_items", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id").notNull().references(() => njmvcCategoriesTable.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  hasMeasurement: boolean("has_measurement").notNull().default(false),
  measurementUnit: text("measurement_unit"),
  measurementPosition: text("measurement_position"),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const njmvcInspectionsTable = pgTable("njmvc_inspections", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").notNull().references(() => vehiclesTable.id),
  operatorName: text("operator_name"),
  address: text("address"),
  mechanicNamePrint: text("mechanic_name_print"),
  mechanicNameSigned: text("mechanic_name_signed"),
  reportNumber: text("report_number"),
  fleetUnitNumber: text("fleet_unit_number"),
  mileage: integer("mileage"),
  vehicleType: text("vehicle_type"),
  vin: text("vin"),
  licensePlate: text("license_plate"),
  inspectionDate: date("inspection_date"),
  purchaseDate: date("purchase_date"),
  certifiedPassed: boolean("certified_passed").notNull().default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const njmvcInspectionResultsTable = pgTable("njmvc_inspection_results", {
  id: serial("id").primaryKey(),
  inspectionId: integer("inspection_id").notNull().references(() => njmvcInspectionsTable.id, { onDelete: "cascade" }),
  itemId: integer("item_id").notNull().references(() => njmvcItemsTable.id, { onDelete: "restrict" }),
  status: text("status"),
  repairedDate: date("repaired_date"),
  measurementValue: text("measurement_value"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type NjmvcCategory = typeof njmvcCategoriesTable.$inferSelect;
export type NjmvcItem = typeof njmvcItemsTable.$inferSelect;
export type NjmvcInspection = typeof njmvcInspectionsTable.$inferSelect;
export type NjmvcInspectionResult = typeof njmvcInspectionResultsTable.$inferSelect;
