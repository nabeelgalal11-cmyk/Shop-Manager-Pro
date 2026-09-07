import { jsonb, integer, pgEnum, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { estimateRevisionsTable } from "./estimate_revisions";

export const estimateApprovalDecisionEnum = pgEnum("estimate_approval_decision", ["approved", "partially_approved", "declined"]);
/** Immutable customer decision snapshot; application roles must prohibit UPDATE/DELETE. */
export const estimateApprovalsTable = pgTable("estimate_approvals", {
  id: serial("id").primaryKey(),
  estimateRevisionId: integer("estimate_revision_id").notNull().references(() => estimateRevisionsTable.id, { onDelete: "restrict" }),
  decision: estimateApprovalDecisionEnum("decision").notNull(),
  signerName: text("signer_name"),
  signerEmail: text("signer_email"),
  signatureUrl: text("signature_url"),
  documentHash: text("document_hash").notNull(),
  requestIp: text("request_ip"),
  requestUserAgent: text("request_user_agent"),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("estimate_approvals_revision_unique").on(t.estimateRevisionId)]);

export type EstimateApproval = typeof estimateApprovalsTable.$inferSelect;
export type InsertEstimateApproval = typeof estimateApprovalsTable.$inferInsert;