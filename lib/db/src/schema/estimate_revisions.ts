import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, numeric, pgEnum, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { employeesTable } from "./employees";
import { repairOrdersTable } from "./repair_orders";

export const estimateRevisionKindEnum = pgEnum("estimate_revision_kind", ["estimate", "supplement"]);
export const estimateRevisionStatusEnum = pgEnum("estimate_revision_status", ["draft", "sent", "approved", "partially_approved", "declined", "superseded"]);

export const estimateRevisionsTable = pgTable("estimate_revisions", {
  id: serial("id").primaryKey(),
  repairOrderId: integer("repair_order_id").notNull().references(() => repairOrdersTable.id, { onDelete: "cascade" }),
  revisionNo: integer("revision_no").notNull(),
  kind: estimateRevisionKindEnum("kind").notNull().default("estimate"),
  status: estimateRevisionStatusEnum("status").notNull().default("draft"),
  notes: text("notes"),
  customerSnapshot: jsonb("customer_snapshot").$type<Record<string, unknown>>().notNull(),
  vehicleSnapshot: jsonb("vehicle_snapshot").$type<Record<string, unknown>>().notNull(),
  subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
  taxRateBps: integer("tax_rate_bps").notNull().default(0),
  taxAmount: numeric("tax_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 14, scale: 2 }).notNull().default("0"),
  publicToken: text("public_token"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdById: integer("created_by_id").notNull().references(() => employeesTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("estimate_revisions_ro_revision_unique").on(t.repairOrderId, t.revisionNo),
  uniqueIndex("estimate_revisions_public_token_unique").on(t.publicToken),
  uniqueIndex("estimate_revisions_one_sent_active").on(t.repairOrderId).where(sql`${t.status} = 'sent'`),
  index("estimate_revisions_ro_status_idx").on(t.repairOrderId, t.status),
  index("estimate_revisions_public_token_idx").on(t.publicToken),
  check("estimate_revisions_no_positive", sql`${t.revisionNo} > 0`),
  check("estimate_revisions_totals_nonnegative", sql`${t.subtotal} >= 0 AND ${t.taxAmount} >= 0 AND ${t.total} >= 0 AND ${t.taxRateBps} BETWEEN 0 AND 10000`),
]);

export const insertEstimateRevisionSchema = createInsertSchema(estimateRevisionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEstimateRevision = z.infer<typeof insertEstimateRevisionSchema>;
export type EstimateRevision = typeof estimateRevisionsTable.$inferSelect;