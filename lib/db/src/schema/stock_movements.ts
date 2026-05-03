import { pgTable, serial, integer, text, numeric, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { inventoryTable } from "./inventory";

export const stockMovementReasons = [
  "purchase_received",
  "purchase_unreceived",
  "ro_consumed",
  "ro_unconsumed",
  "invoice_consumed",
  "invoice_unconsumed",
  "manual_adjustment",
] as const;

export type StockMovementReason = typeof stockMovementReasons[number];

export const stockMovementsTable = pgTable("stock_movements", {
  id: serial("id").primaryKey(),
  inventoryId: integer("inventory_id").notNull().references(() => inventoryTable.id, { onDelete: "cascade" }),
  delta: integer("delta").notNull(),
  reason: text("reason").notNull(),
  referenceTable: text("reference_table"),
  referenceId: integer("reference_id"),
  referenceLineId: integer("reference_line_id"),
  unitCost: numeric("unit_cost", { precision: 10, scale: 2 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  createdById: integer("created_by_id"),
}, (t) => ({
  inventoryIdx: index("stock_movements_inventory_id_idx").on(t.inventoryId),
  refIdx: index("stock_movements_reference_idx").on(t.referenceTable, t.referenceId),
  // Composite source-key lookup index used by the apply/reverse helpers
  // to count applies vs reverses for the same source. NOT unique — apply
  // rows may legitimately repeat after a compensating reverse (e.g. an
  // RO toggled completed -> incomplete -> completed must write fresh
  // ro_consumed rows on each completion).
  sourceIdx: index("stock_movements_source_idx").on(
    t.inventoryId,
    t.referenceTable,
    t.referenceId,
    sql`coalesce(${t.referenceLineId}, 0)`,
    t.reason,
  ),
}));

export type StockMovement = typeof stockMovementsTable.$inferSelect;
export type InsertStockMovement = typeof stockMovementsTable.$inferInsert;
