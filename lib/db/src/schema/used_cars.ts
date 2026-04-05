import { pgTable, serial, text, numeric, integer, date, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { customersTable } from "./customers";

export const usedCarsTable = pgTable("used_cars", {
  id: serial("id").primaryKey(),
  vin: text("vin"),
  year: integer("year").notNull(),
  make: text("make").notNull(),
  model: text("model").notNull(),
  trim: text("trim"),
  color: text("color"),
  mileage: integer("mileage"),
  condition: text("condition"),
  purchasePrice: numeric("purchase_price", { precision: 10, scale: 2 }).notNull(),
  sellingPrice: numeric("selling_price", { precision: 10, scale: 2 }).notNull(),
  status: text("status").notNull().default("available"),
  customerId: integer("customer_id").references(() => customersTable.id),
  purchaseDate: date("purchase_date"),
  saleDate: date("sale_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertUsedCarSchema = createInsertSchema(usedCarsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUsedCar = z.infer<typeof insertUsedCarSchema>;
export type UsedCar = typeof usedCarsTable.$inferSelect;
