import { pgTable, serial, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { estimatesTable } from "./estimates";

export const estimateEventsTable = pgTable(
  "estimate_events",
  {
    id: serial("id").primaryKey(),
    estimateId: integer("estimate_id")
      .notNull()
      .references(() => estimatesTable.id, { onDelete: "cascade" }),
    event: text("event").notNull(), // sent | approved | declined | converted_to_ro | converted_to_invoice
    actor: text("actor"),            // 'customer' | 'shop' | username
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    estimateIdx: index("estimate_events_estimate_idx").on(t.estimateId, t.createdAt),
  }),
);

export type EstimateEvent = typeof estimateEventsTable.$inferSelect;
export type InsertEstimateEvent = typeof estimateEventsTable.$inferInsert;
