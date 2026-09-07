import { index, integer, jsonb, pgEnum, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { employeesTable } from "./employees";
import { repairOrdersTable } from "./repair_orders";

export const repairOrderEventTypeEnum = pgEnum("repair_order_event_type", [
  "opened", "status_changed", "assigned", "estimate_created", "estimate_sent",
  "estimate_decided", "supplement_created", "supplement_sent", "supplement_decided",
  "work_authorized", "work_performed", "invoice_created", "invoice_issued", "invoice_voided",
  "payment_recorded", "payment_failed", "payment_refunded", "payment_voided",
  "ro_completed", "cancelled", "note_added",
]);
/** Append-only audit log. Payload is event-specific but the event discriminator is constrained. */
export const repairOrderEventsTable = pgTable("repair_order_events", {
  id: serial("id").primaryKey(),
  repairOrderId: integer("repair_order_id").notNull().references(() => repairOrdersTable.id, { onDelete: "cascade" }),
  eventType: repairOrderEventTypeEnum("event_type").notNull(),
  actorId: integer("actor_id").references(() => employeesTable.id, { onDelete: "set null" }),
  actorLabel: text("actor_label"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("repair_order_events_ro_occurred_idx").on(t.repairOrderId, t.occurredAt)]);

export type RepairOrderEvent = typeof repairOrderEventsTable.$inferSelect;
export type InsertRepairOrderEvent = typeof repairOrderEventsTable.$inferInsert;