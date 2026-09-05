import { integer, pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";
import { employeesTable } from "./employees";

export const passwordResetTokensTable = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  employeeUnusedIdx: index("password_reset_tokens_employee_unused_idx").on(table.employeeId, table.usedAt),
  expiryIdx: index("password_reset_tokens_expires_at_idx").on(table.expiresAt),
}));

export type PasswordResetToken = typeof passwordResetTokensTable.$inferSelect;