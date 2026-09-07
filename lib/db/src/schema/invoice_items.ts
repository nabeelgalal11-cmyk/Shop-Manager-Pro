import { sql } from "drizzle-orm";
import { check, integer, numeric, pgTable, serial, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { invoicesTable } from "./invoices";
import { repairOrderWorkItemsTable } from "./repair_order_work_items";
import { estimateItemKindEnum } from "./estimate_items";

/** Immutable commercial snapshot copied from one authorized work item. */
export const invoiceItemsTable = pgTable("invoice_items", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => invoicesTable.id, { onDelete: "cascade" }),
  sourceWorkItemId: integer("source_work_item_id").notNull().references(() => repairOrderWorkItemsTable.id, { onDelete: "restrict" }),
  position: integer("position").notNull(),
  kind: estimateItemKindEnum("kind").notNull(),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
  unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull(),
  unitCost: numeric("unit_cost", { precision: 14, scale: 2 }),
  lineTotal: numeric("line_total", { precision: 14, scale: 2 }).notNull(),
}, (t) => [
  uniqueIndex("invoice_items_source_work_item_unique").on(t.sourceWorkItemId),
  uniqueIndex("invoice_items_invoice_position_unique").on(t.invoiceId, t.position),
  check("invoice_items_position_positive", sql`${t.position} > 0`),
  check("invoice_items_money_valid", sql`${t.quantity} > 0 AND ${t.unitPrice} >= 0 AND (${t.unitCost} IS NULL OR ${t.unitCost} >= 0)`),
]);

export const insertInvoiceItemSchema = createInsertSchema(invoiceItemsTable).omit({ id: true });
export type InsertInvoiceItem = z.infer<typeof insertInvoiceItemSchema>;
export type InvoiceItem = typeof invoiceItemsTable.$inferSelect;