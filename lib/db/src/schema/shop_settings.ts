import { pgTable, serial, numeric, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const shopSettingsTable = pgTable("shop_settings", {
  id: serial("id").primaryKey(),
  laborRate: numeric("labor_rate", { precision: 10, scale: 2 }).notNull().default("95"),
  stripePublishableKey: text("stripe_publishable_key"),
  stripeSecretKey: text("stripe_secret_key"),
  stripeWebhookSecret: text("stripe_webhook_secret"),
  // Whether ACH (us_bank_account) is offered alongside card on Checkout.
  // Off by default since ACH has multi-day settlement and the shop may not
  // want to wait for funds to clear before releasing a vehicle.
  stripeAchEnabled: boolean("stripe_ach_enabled").notNull().default(false),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ShopSettings = typeof shopSettingsTable.$inferSelect;
