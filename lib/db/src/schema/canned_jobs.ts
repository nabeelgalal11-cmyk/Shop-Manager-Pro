import { pgTable, serial, text, numeric, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export type CannedJobItem = {
  type: "labor" | "part" | "fee" | "discount";
  description: string;
  quantity: number;
  unitPrice: number;
};

export const cannedJobsTable = pgTable("canned_jobs", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category"),
  description: text("description"),
  estimatedHours: numeric("estimated_hours", { precision: 10, scale: 2 }),
  items: jsonb("items").$type<CannedJobItem[]>().notNull().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCannedJobSchema = createInsertSchema(cannedJobsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCannedJob = z.infer<typeof insertCannedJobSchema>;
export type CannedJob = typeof cannedJobsTable.$inferSelect;
