import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const authSessionsTable = pgTable("auth_sessions", {
  sid: text("sid").primaryKey(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire", { withTimezone: true }).notNull(),
}, (table) => ({
  expireIdx: index("auth_sessions_expire_idx").on(table.expire),
  userIdIdx: index("auth_sessions_user_id_idx").on(sql`(${table.sess}->>'userId')`),
}));

export const authLoginAttemptsTable = pgTable("auth_login_attempts", {
  ip: text("ip").primaryKey(),
  attemptCount: integer("attempt_count").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => ({
  expiresAtIdx: index("auth_login_attempts_expires_at_idx").on(table.expiresAt),
}));
