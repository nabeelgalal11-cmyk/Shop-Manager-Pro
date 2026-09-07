import { index, integer, pgEnum, pgTable, serial, uniqueIndex } from "drizzle-orm/pg-core";
import { estimateApprovalsTable } from "./estimate_approvals";
import { estimateItemsTable } from "./estimate_items";

export const estimateApprovalItemDecisionEnum = pgEnum("estimate_approval_item_decision", ["approved", "declined"]);
/** Immutable normalized decisions that belong to an immutable approval header. */
export const estimateApprovalItemsTable = pgTable("estimate_approval_items", {
  id: serial("id").primaryKey(),
  approvalId: integer("approval_id").notNull().references(() => estimateApprovalsTable.id, { onDelete: "restrict" }),
  estimateItemId: integer("estimate_item_id").notNull().references(() => estimateItemsTable.id, { onDelete: "restrict" }),
  decision: estimateApprovalItemDecisionEnum("decision").notNull(),
}, (t) => [
  uniqueIndex("estimate_approval_items_approval_item_unique").on(t.approvalId, t.estimateItemId),
  index("estimate_approval_items_item_idx").on(t.estimateItemId),
]);

export type EstimateApprovalItem = typeof estimateApprovalItemsTable.$inferSelect;
export type InsertEstimateApprovalItem = typeof estimateApprovalItemsTable.$inferInsert;