import { pgTable, serial, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const customerCategoriesTable = pgTable("customer_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  laborRate: numeric("labor_rate", { precision: 10, scale: 2 }).notNull().default("120"),
  partsMarkup: numeric("parts_markup", { precision: 5, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCustomerCategorySchema = createInsertSchema(customerCategoriesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCustomerCategory = z.infer<typeof insertCustomerCategorySchema>;
export type CustomerCategory = typeof customerCategoriesTable.$inferSelect;
