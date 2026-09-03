import { pgTable, serial, text, integer, numeric, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { invoicesTable } from "./invoices";
import { paymentsTable } from "./payments";

/** Provider-agnostic local-to-Square mapping. Never contains credentials. */
export const squareMappingsTable = pgTable("square_mappings", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  localId: integer("local_id").notNull(),
  squareId: text("square_id").notNull(),
  squareVersion: integer("square_version"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("square_mappings_entity_local_unique").on(table.entityType, table.localId),
  uniqueIndex("square_mappings_square_id_unique").on(table.squareId),
]);

export const squareWebhookEventsTable = pgTable("square_webhook_events", {
  id: serial("id").primaryKey(),
  squareEventId: text("square_event_id").notNull().unique(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  failureReason: text("failure_reason"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export const squareSyncStatesTable = pgTable("square_sync_states", {
  id: serial("id").primaryKey(),
  resource: text("resource").notNull().unique(),
  cursor: text("cursor"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const squareTerminalCheckoutsTable = pgTable("square_terminal_checkouts", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => invoicesTable.id),
  squareCheckoutId: text("square_checkout_id").notNull().unique(),
  deviceId: text("device_id").notNull(),
  status: text("status").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  squarePaymentId: text("square_payment_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const squareRefundsTable = pgTable("square_refunds", {
  id: serial("id").primaryKey(),
  paymentId: integer("payment_id").notNull().references(() => paymentsTable.id),
  squareRefundId: text("square_refund_id").notNull().unique(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  status: text("status").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSquareMappingSchema = createInsertSchema(squareMappingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSquareMapping = z.infer<typeof insertSquareMappingSchema>;
export type SquareMapping = typeof squareMappingsTable.$inferSelect;