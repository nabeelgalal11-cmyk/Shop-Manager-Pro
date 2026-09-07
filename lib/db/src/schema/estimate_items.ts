import { sql } from "drizzle-orm";
import { check, integer, numeric, pgEnum, pgTable, serial, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { estimateRevisionsTable } from "./estimate_revisions";
import { inventoryTable } from "./inventory";

export const estimateItemKindEnum = pgEnum("estimate_item_kind", ["part", "labor", "fee", "discount"]);
export const estimateItemsTable = pgTable("estimate_items", {
  id: serial("id").primaryKey(),
  estimateRevisionId: integer("estimate_revision_id").notNull().references(() => estimateRevisionsTable.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  kind: estimateItemKindEnum("kind").notNull(),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull().default("1"),
  unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull().default("0"),
  unitCost: numeric("unit_cost", { precision: 14, scale: 2 }),
  inventoryItemId: integer("inventory_item_id").references(() => inventoryTable.id, { onDelete: "set null" }),
  estimatedHours: numeric("estimated_hours", { precision: 10, scale: 2 }),
  warrantyMonths: integer("warranty_months"),
  warrantyMiles: integer("warranty_miles"),
}, (t) => [
  uniqueIndex("estimate_items_revision_position_unique").on(t.estimateRevisionId, t.position),
  check("estimate_items_position_positive", sql`${t.position} > 0`),
  check("estimate_items_quantity_positive", sql`${t.quantity} > 0`),
  check("estimate_items_money_nonnegative", sql`${t.unitPrice} >= 0 AND (${t.unitCost} IS NULL OR ${t.unitCost} >= 0) AND (${t.estimatedHours} IS NULL OR ${t.estimatedHours} >= 0)`),
  check("estimate_items_warranty_nonnegative", sql`(${t.warrantyMonths} IS NULL OR ${t.warrantyMonths} >= 0) AND (${t.warrantyMiles} IS NULL OR ${t.warrantyMiles} >= 0)`),
]);

export const insertEstimateItemSchema = createInsertSchema(estimateItemsTable).omit({ id: true });
export type InsertEstimateItem = z.infer<typeof insertEstimateItemSchema>;
export type EstimateItem = typeof estimateItemsTable.$inferSelect;