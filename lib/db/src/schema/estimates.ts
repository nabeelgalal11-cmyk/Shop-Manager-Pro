import { pgTable, serial, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { customersTable } from "./customers";
import { vehiclesTable } from "./vehicles";

export const estimatesTable = pgTable("estimates", {
  id: serial("id").primaryKey(),
  estimateNumber: text("estimate_number").notNull().unique(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  vehicleId: integer("vehicle_id").references(() => vehiclesTable.id),
  status: text("status").notNull().default("draft"),
  notes: text("notes"),
  subtotal: numeric("subtotal", { precision: 10, scale: 2 }).notNull().default("0"),
  taxRate: numeric("tax_rate", { precision: 5, scale: 4 }).notNull().default("0"),
  taxAmount: numeric("tax_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  discountAmount: numeric("discount_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 10, scale: 2 }).notNull().default("0"),
  publicToken: text("public_token").unique(),
  sentAt: timestamp("sent_at"),
  customerSignatureUrl: text("customer_signature_url"),
  customerSignedAt: timestamp("customer_signed_at"),
  customerSignerName: text("customer_signer_name"),
  customerIp: text("customer_ip"),
  declineReason: text("decline_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertEstimateSchema = createInsertSchema(estimatesTable).omit({
  id: true,
  estimateNumber: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertEstimate = z.infer<typeof insertEstimateSchema>;
export type Estimate = typeof estimatesTable.$inferSelect;
