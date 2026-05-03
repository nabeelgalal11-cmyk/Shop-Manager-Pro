import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { employeesTable } from "./employees";

export const userBoardPreferencesTable = pgTable(
  "user_board_preferences",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),
    boardKey: text("board_key").notNull(),
    columnOrder: text("column_order").array().notNull().default([]),
    hiddenColumns: text("hidden_columns").array().notNull().default([]),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    userBoardUnique: uniqueIndex("user_board_preferences_user_board_idx").on(
      table.userId,
      table.boardKey,
    ),
  }),
);

export type UserBoardPreference = typeof userBoardPreferencesTable.$inferSelect;
