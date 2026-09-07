import { index, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/** Cross-processor receipt/dedupe ledger; payload is retained for reconciliation. */
export const processorWebhookReceiptsTable = pgTable("processor_webhook_receipts", {
  id: serial("id").primaryKey(),
  processor: text("processor").notNull(),
  eventId: text("event_id").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  failureReason: text("failure_reason"),
}, (t) => [
  uniqueIndex("processor_webhook_receipts_processor_event_unique").on(t.processor, t.eventId),
  index("processor_webhook_receipts_pending_idx").on(t.processor, t.processedAt),
]);

export type ProcessorWebhookReceipt = typeof processorWebhookReceiptsTable.$inferSelect;
export type InsertProcessorWebhookReceipt = typeof processorWebhookReceiptsTable.$inferInsert;