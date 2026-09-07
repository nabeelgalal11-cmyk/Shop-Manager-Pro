import { sql } from "drizzle-orm";
import { boolean, check, integer, jsonb, numeric, pgEnum, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { employeesTable } from "./employees";
import { repairOrdersTable } from "./repair_orders";

export const invoiceStatusEnum = pgEnum("invoice_status", ["draft", "issued", "partially_paid", "paid", "void"]);
export const invoicesTable = pgTable("invoices", {
  id: serial("id").primaryKey(),
  invoiceNumber: text("invoice_number").notNull().unique(),
  repairOrderId: integer("repair_order_id").notNull().references(() => repairOrdersTable.id, { onDelete: "restrict" }),
  customerSnapshot: jsonb("customer_snapshot").$type<Record<string, unknown>>().notNull(),
  vehicleSnapshot: jsonb("vehicle_snapshot").$type<Record<string, unknown>>().notNull(),
  status: invoiceStatusEnum("status").notNull().default("draft"),
  notes: text("notes"),
  subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
  taxRateBps: integer("tax_rate_bps").notNull().default(0),
  taxAmount: numeric("tax_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 14, scale: 2 }).notNull().default("0"),
  amountPaid: numeric("amount_paid", { precision: 14, scale: 2 }).notNull().default("0"),
  balance: numeric("balance", { precision: 14, scale: 2 }).notNull().default("0"),
  taxExempt: boolean("tax_exempt").notNull().default(false),
  taxExemptNumber: text("tax_exempt_number"),
  publicToken: text("public_token").unique(),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  issuedById: integer("issued_by_id").references(() => employeesTable.id, { onDelete: "set null" }),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  voidedById: integer("voided_by_id").references(() => employeesTable.id, { onDelete: "set null" }),
  voidReason: text("void_reason"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("invoices_repair_order_unique").on(t.repairOrderId),
  check("invoices_version_positive", sql`${t.version} > 0`),
  check("invoices_totals_nonnegative", sql`${t.subtotal} >= 0 AND ${t.taxAmount} >= 0 AND ${t.total} >= 0 AND ${t.amountPaid} >= 0 AND ${t.balance} >= 0 AND ${t.taxRateBps} BETWEEN 0 AND 10000`),
  check("invoices_void_metadata", sql`(${t.status} <> 'void') OR (${t.voidedAt} IS NOT NULL AND ${t.voidReason} IS NOT NULL)`),
]);

export const insertInvoiceSchema = createInsertSchema(invoicesTable).omit({ id: true, invoiceNumber: true, version: true, createdAt: true, updatedAt: true });
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoicesTable.$inferSelect;