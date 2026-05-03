import { pgTable, serial, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { employeesTable } from "./employees";

export const activityEventsTable = pgTable(
  "activity_events",
  {
    id: serial("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    eventType: text("event_type").notNull(),
    actorId: integer("actor_id").references(() => employeesTable.id, { onDelete: "set null" }),
    actorLabel: text("actor_label"),
    meta: jsonb("meta").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    entityIdx: index("activity_events_entity_idx").on(t.entityType, t.entityId, t.createdAt),
    entityCursorIdx: index("activity_events_entity_cursor_idx").on(t.entityType, t.entityId, t.id),
  }),
);

export type ActivityEvent = typeof activityEventsTable.$inferSelect;
export type InsertActivityEvent = typeof activityEventsTable.$inferInsert;
