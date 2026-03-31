import { pgTable, serial, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { estimatesTable } from "./estimates";
import { invoicesTable } from "./invoices";

export const lineItemsTable = pgTable("line_items", {
  id: serial("id").primaryKey(),
  estimateId: integer("estimate_id").references(() => estimatesTable.id),
  invoiceId: integer("invoice_id").references(() => invoicesTable.id),
  type: text("type").notNull().default("part"),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull().default("1"),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 10, scale: 2 }).notNull().default("0"),
  partNumber: text("part_number"),
  inventoryItemId: integer("inventory_item_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertLineItemSchema = createInsertSchema(lineItemsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertLineItem = z.infer<typeof insertLineItemSchema>;
export type LineItem = typeof lineItemsTable.$inferSelect;
