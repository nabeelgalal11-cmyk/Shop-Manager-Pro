import { pgTable, serial, text, numeric, integer, date, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { customersTable } from "./customers";
import { inventoryTable } from "./inventory";
import { usedCarsTable } from "./used_cars";

export const purchasesTable = pgTable("purchases", {
  id: serial("id").primaryKey(),
  supplier: text("supplier").notNull(),
  supplierContact: text("supplier_contact"),
  supplierEmail: text("supplier_email"),
  supplierPhone: text("supplier_phone"),
  invoiceNumber: text("invoice_number"),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  tax: numeric("tax", { precision: 10, scale: 2 }).default("0"),
  shipping: numeric("shipping", { precision: 10, scale: 2 }).default("0"),
  status: text("status").notNull().default("pending"),
  purchaseDate: date("purchase_date").notNull(),
  notes: text("notes"),
  invoiceFilePath: text("invoice_file_path"),
  invoiceFileName: text("invoice_file_name"),
  invoiceFileType: text("invoice_file_type"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const purchaseLineItemsTable = pgTable("purchase_line_items", {
  id: serial("id").primaryKey(),
  purchaseId: integer("purchase_id").notNull().references(() => purchasesTable.id, { onDelete: "cascade" }),
  itemType: text("item_type").notNull(),
  inventoryId: integer("inventory_id").references(() => inventoryTable.id),
  usedCarId: integer("used_car_id").references(() => usedCarsTable.id),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull().default("1"),
  unitCost: numeric("unit_cost", { precision: 10, scale: 2 }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPurchaseSchema = createInsertSchema(purchasesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPurchaseLineItemSchema = createInsertSchema(purchaseLineItemsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertPurchase = z.infer<typeof insertPurchaseSchema>;
export type Purchase = typeof purchasesTable.$inferSelect;
export type PurchaseLineItem = typeof purchaseLineItemsTable.$inferSelect;
