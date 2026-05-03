import { pgTable, serial, numeric, timestamp } from "drizzle-orm/pg-core";

export const shopSettingsTable = pgTable("shop_settings", {
  id: serial("id").primaryKey(),
  laborRate: numeric("labor_rate", { precision: 10, scale: 2 }).notNull().default("95"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ShopSettings = typeof shopSettingsTable.$inferSelect;
