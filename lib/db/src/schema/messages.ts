import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { customersTable } from "./customers";
import { repairOrdersTable } from "./repair_orders";
import { estimatesTable } from "./estimates";
import { invoicesTable } from "./invoices";

export const messagesTable = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customersTable.id, { onDelete: "cascade" }),
    repairOrderId: integer("repair_order_id").references(() => repairOrdersTable.id, {
      onDelete: "set null",
    }),
    estimateId: integer("estimate_id").references(() => estimatesTable.id, {
      onDelete: "set null",
    }),
    invoiceId: integer("invoice_id").references(() => invoicesTable.id, {
      onDelete: "set null",
    }),
    direction: text("direction").notNull(), // 'inbound' | 'outbound'
    channel: text("channel").notNull().default("sms"), // future-proof
    fromNumber: text("from_number"),
    toNumber: text("to_number"),
    body: text("body").notNull(),
    status: text("status").notNull().default("queued"), // queued|sent|delivered|failed|received
    failureReason: text("failure_reason"),
    twilioSid: text("twilio_sid"),
    readAt: timestamp("read_at"),
    sentByUserId: integer("sent_by_user_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    customerIdx: index("messages_customer_idx").on(t.customerId, t.createdAt),
    twilioSidIdx: index("messages_twilio_sid_idx").on(t.twilioSid),
    inboundUnreadIdx: index("messages_inbound_unread_idx").on(t.direction, t.readAt),
  }),
);

export type Message = typeof messagesTable.$inferSelect;
export type InsertMessage = typeof messagesTable.$inferInsert;
