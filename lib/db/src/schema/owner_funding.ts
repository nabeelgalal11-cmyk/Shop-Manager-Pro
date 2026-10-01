import { pgTable, serial, text, numeric, date, timestamp, integer, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const ownerFundingTypes = ["loan", "contribution", "repayment"] as const;
export type OwnerFundingType = typeof ownerFundingTypes[number];

export const ownerFundingEntriesTable = pgTable("owner_funding_entries", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  entryDate: date("entry_date", { mode: "string" }).notNull(),
  description: text("description").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdById: integer("created_by_id"),
}, (table) => ({
  typeCheck: check("owner_funding_entries_type_check", sql`${table.type} IN ('loan', 'contribution', 'repayment')`),
  amountCheck: check("owner_funding_entries_amount_check", sql`${table.amount} > 0`),
  dateIdx: index("owner_funding_entries_entry_date_idx").on(table.entryDate, table.id),
}));

export type OwnerFundingEntry = typeof ownerFundingEntriesTable.$inferSelect;
export type InsertOwnerFundingEntry = typeof ownerFundingEntriesTable.$inferInsert;