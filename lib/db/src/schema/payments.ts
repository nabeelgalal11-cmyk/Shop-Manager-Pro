import { sql } from "drizzle-orm";
import { check, index, integer, numeric, pgEnum, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { invoicesTable } from "./invoices";

export const paymentStatusEnum = pgEnum("payment_status", ["pending", "succeeded", "failed", "refunded", "void"]);
/** Immutable financial ledger entries; refunds/voids point at their original payment. */
export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => invoicesTable.id, { onDelete: "restrict" }),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  status: paymentStatusEnum("status").notNull().default("pending"),
  method: text("method").notNull(),
  processor: text("processor"),
  processorPaymentId: text("processor_payment_id"),
  processorEventId: text("processor_event_id"),
  attemptKey: text("attempt_key").notNull(),
  idempotencyKey: text("idempotency_key"),
  parentPaymentId: integer("parent_payment_id").references((): any => paymentsTable.id, { onDelete: "restrict" }),
  referenceNumber: text("reference_number"),
  failureReason: text("failure_reason"),
  refundedAt: timestamp("refunded_at", { withTimezone: true }),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("payments_invoice_attempt_unique").on(t.invoiceId, t.attemptKey),
  uniqueIndex("payments_processor_payment_unique").on(t.processor, t.processorPaymentId).where(sql`${t.processorPaymentId} IS NOT NULL`),
  uniqueIndex("payments_processor_event_unique").on(t.processor, t.processorEventId).where(sql`${t.processorEventId} IS NOT NULL`),
  index("payments_invoice_status_idx").on(t.invoiceId, t.status),
  index("payments_parent_idx").on(t.parentPaymentId),
  check("payments_amount_positive", sql`${t.amount} > 0`),
  // A void can also be the terminal result of an unprocessed pending attempt.
  // Refunds and any linked reversal must identify the original ledger entry.
  check("payments_reversal_parent", sql`(${t.status} = 'refunded' AND ${t.parentPaymentId} IS NOT NULL) OR (${t.parentPaymentId} IS NULL) OR (${t.status} = 'void')`),
]);

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ id: true, createdAt: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;