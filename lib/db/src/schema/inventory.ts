import { pgTable, serial, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { suppliersTable } from "./suppliers";

export const inventoryTable = pgTable("inventory", {
  id: serial("id").primaryKey(),
  partNumber: text("part_number"),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category").notNull(),
  vendor: text("vendor"),
  preferredSupplierId: integer("preferred_supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  costPrice: numeric("cost_price", { precision: 10, scale: 2 }).notNull().default("0"),
  sellPrice: numeric("sell_price", { precision: 10, scale: 2 }).notNull().default("0"),
  quantity: integer("quantity").notNull().default(0),
  minQuantity: integer("min_quantity").notNull().default(0),
  location: text("location"),
  notes: text("notes"),
  compatibleVehicles: text("compatible_vehicles"),
  defaultWarrantyMonths: integer("default_warranty_months"),
  defaultWarrantyMiles: integer("default_warranty_miles"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertInventoryItemSchema = createInsertSchema(inventoryTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertInventoryItem = z.infer<typeof insertInventoryItemSchema>;
export type InventoryItem = typeof inventoryTable.$inferSelect;
