/**
 * Transactional repair-order workflow.  Routes deliberately stay thin and
 * call this module; no route is allowed to write the repair-domain tables
 * directly.  Database numeric values are converted at this boundary rather
 * than being calculated with JavaScript floating point values.
 */
import { randomBytes, createHash } from "node:crypto";
import {
  db, customersTable, employeesTable, estimateApprovalItemsTable,
  estimateApprovalsTable, estimateItemsTable, estimateRevisionsTable,
  idempotencyKeysTable, inventoryTable, invoiceItemsTable, invoicesTable, paymentsTable, repairOrderEventsTable, repairOrdersTable,
  repairOrderWorkItemsTable, stockMovementsTable, vehiclesTable,
  calculateInvoiceTotals, canTransitionEstimateRevision, canTransitionRepairOrder,
  lineTotalCents,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export class WorkflowError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
const cents = (value: unknown): bigint => {
  const text = String(value ?? "").trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) throw new WorkflowError("Invalid money value");
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2)) * (whole.startsWith("-") ? -1n : 1n);
};
const milli = (value: unknown): bigint => {
  const text = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,3})?$/.test(text)) throw new WorkflowError("Invalid quantity");
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * 1000n + BigInt((fraction + "000").slice(0, 3));
};
const money = (value: bigint) => {
  const sign = value < 0n ? "-" : "";
  const n = value < 0n ? -value : value;
  return `${sign}${n / 100n}.${(n % 100n).toString().padStart(2, "0")}`;
};
const quantity = (value: bigint) => `${value / 1000n}.${(value % 1000n).toString().padStart(3, "0")}`;
const timestamp = (value: unknown, field: string): Date | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new WorkflowError(`Invalid ${field}`);
    return value;
  }
  if (typeof value !== "string") throw new WorkflowError(`Invalid ${field}`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new WorkflowError(`Invalid ${field}`);
  return parsed;
};
const event = (tx: Tx, repairOrderId: number, eventType: any, actorId: number | null, payload: Record<string, unknown> = {}) =>
  tx.insert(repairOrderEventsTable).values({ repairOrderId, eventType, actorId, payload });
const snapshot = (customer: any, vehicle: any) => ({
  customer: { id: customer.id, firstName: customer.firstName, lastName: customer.lastName, email: customer.email, phone: customer.phone },
  vehicle: { id: vehicle.id, year: vehicle.year, make: vehicle.make, model: vehicle.model, vin: vehicle.vin, licensePlate: vehicle.licensePlate },
});

export async function createRepairOrder(input: {
  customerId: number; vehicleId: number; assignedToId?: number | null; priority?: "low" | "normal" | "high" | "urgent";
  complaint?: string | null; diagnosis?: string | null; notes?: string | null; mileageIn?: number | null; promisedAt?: Date | string | null;
}, actorId: number) {
  return db.transaction(async (tx) => {
    const [[actor], [customer], [vehicle]] = await Promise.all([
      tx.select({ id: employeesTable.id }).from(employeesTable).where(eq(employeesTable.id, actorId)).for("update"),
      tx.select().from(customersTable).where(eq(customersTable.id, input.customerId)).for("update"),
      tx.select().from(vehiclesTable).where(eq(vehiclesTable.id, input.vehicleId)).for("update"),
    ]);
    if (!actor) throw new WorkflowError("Authenticated employee no longer exists", 401);
    if (!customer) throw new WorkflowError("Customer not found", 404);
    if (!vehicle || vehicle.customerId !== customer.id) throw new WorkflowError("Vehicle does not belong to customer", 422);
    const promisedAt = timestamp(input.promisedAt, "promisedAt");
    const [ro] = await tx.insert(repairOrdersTable).values({
      customerId: input.customerId,
      vehicleId: input.vehicleId,
      assignedToId: input.assignedToId ?? null,
      priority: input.priority ?? "normal",
      complaint: input.complaint ?? null,
      diagnosis: input.diagnosis ?? null,
      notes: input.notes ?? null,
      mileageIn: input.mileageIn ?? null,
      promisedAt,
      createdById: actorId,
      status: "open",
      orderNumber: `RO-${Date.now()}-${randomBytes(3).toString("hex")}`,
    }).returning();
    await event(tx, ro.id, "opened", actorId);
    return ro;
  });
}

export async function updateIntake(repairOrderId: number, version: number, input: Partial<{
  assignedToId: number | null; priority: "low" | "normal" | "high" | "urgent"; complaint: string | null;
  diagnosis: string | null; notes: string | null; mileageIn: number | null; mileageOut: number | null; promisedAt: Date | string | null;
}>, actorId: number) {
  const allowed = ["assignedToId", "priority", "complaint", "diagnosis", "notes", "mileageIn", "mileageOut", "promisedAt"] as const;
  const patch = Object.fromEntries(Object.entries(input).filter(([key]) => (allowed as readonly string[]).includes(key)));
  if (Object.prototype.hasOwnProperty.call(patch, "promisedAt")) {
    patch.promisedAt = timestamp(patch.promisedAt, "promisedAt") ?? null;
  }
  return db.transaction(async (tx) => {
    const [ro] = await tx.select().from(repairOrdersTable).where(eq(repairOrdersTable.id, repairOrderId)).for("update");
    if (!ro) throw new WorkflowError("Repair order not found", 404);
    if (ro.version !== version) throw new WorkflowError("Repair order was changed by another user", 409);
    if (ro.status === "completed" || ro.status === "cancelled") throw new WorkflowError("Cannot edit a closed repair order", 409);
    const [updated] = await tx.update(repairOrdersTable).set({ ...patch, version: ro.version + 1, updatedAt: new Date() })
      .where(eq(repairOrdersTable.id, repairOrderId)).returning();
    await event(tx, repairOrderId, "note_added", actorId, { fields: Object.keys(patch) });
    return updated;
  });
}

export type DraftItem = { position: number; kind: "part" | "labor" | "fee" | "discount"; description: string; quantity: string | number; unitPrice: string | number; unitCost?: string | number | null; inventoryItemId?: number | null; estimatedHours?: string | number | null; warrantyMonths?: number | null; warrantyMiles?: number | null };
export async function createRevision(repairOrderId: number, kind: "estimate" | "supplement", actorId: number, taxRateBps = 0) {
  return db.transaction(async (tx) => {
    const [ro] = await tx.select().from(repairOrdersTable).where(eq(repairOrdersTable.id, repairOrderId)).for("update");
    if (!ro) throw new WorkflowError("Repair order not found", 404);
    if (ro.status === "completed" || ro.status === "cancelled") throw new WorkflowError("Closed repair orders cannot be revised", 409);
    if (kind === "supplement") {
      const approved = await tx.select({ id: estimateRevisionsTable.id }).from(estimateRevisionsTable)
        .where(and(eq(estimateRevisionsTable.repairOrderId, repairOrderId), sql`${estimateRevisionsTable.status} IN ('approved', 'partially_approved')`)).limit(1);
      if (!approved.length) throw new WorkflowError("A supplement requires an initial authorization", 409);
    }
    const [[customer], [vehicle], [max]] = await Promise.all([
      tx.select().from(customersTable).where(eq(customersTable.id, ro.customerId)),
      tx.select().from(vehiclesTable).where(eq(vehiclesTable.id, ro.vehicleId)),
      tx.select({ max: sql<number>`coalesce(max(${estimateRevisionsTable.revisionNo}), 0)::int` }).from(estimateRevisionsTable).where(eq(estimateRevisionsTable.repairOrderId, repairOrderId)),
    ]);
    if (!customer || !vehicle) throw new WorkflowError("Repair order references missing customer or vehicle", 409);
    const [revision] = await tx.insert(estimateRevisionsTable).values({ repairOrderId, revisionNo: max.max + 1, kind, taxRateBps, customerSnapshot: snapshot(customer, vehicle).customer, vehicleSnapshot: snapshot(customer, vehicle).vehicle, createdById: actorId }).returning();
    await event(tx, repairOrderId, kind === "supplement" ? "supplement_created" : "estimate_created", actorId, { revisionId: revision.id });
    return revision;
  });
}

export async function replaceDraftItems(revisionId: number, items: DraftItem[], actorId: number) {
  return db.transaction(async (tx) => {
    const [revision] = await tx.select().from(estimateRevisionsTable).where(eq(estimateRevisionsTable.id, revisionId)).for("update");
    if (!revision) throw new WorkflowError("Revision not found", 404);
    if (revision.status !== "draft") throw new WorkflowError("Only draft revisions are editable", 409);
    if (new Set(items.map((item) => item.position)).size !== items.length || items.some((item) => item.position < 1 || !item.description.trim())) throw new WorkflowError("Items require unique positive positions and descriptions");
    const totals = calculateInvoiceTotals(items.map((item) => ({ quantityMilli: milli(item.quantity), unitPriceCents: cents(item.unitPrice), kind: item.kind })), BigInt(revision.taxRateBps));
    await tx.delete(estimateItemsTable).where(eq(estimateItemsTable.estimateRevisionId, revisionId));
    if (items.length) await tx.insert(estimateItemsTable).values(items.map((item) => ({ ...item, estimateRevisionId: revisionId, quantity: quantity(milli(item.quantity)), unitPrice: money(cents(item.unitPrice)), unitCost: item.unitCost == null ? null : money(cents(item.unitCost)), estimatedHours: item.estimatedHours == null ? null : String(item.estimatedHours) })));
    const [updated] = await tx.update(estimateRevisionsTable).set({ subtotal: money(totals.subtotalCents), taxAmount: money(totals.taxCents), total: money(totals.totalCents), updatedAt: new Date() }).where(eq(estimateRevisionsTable.id, revisionId)).returning();
    await event(tx, revision.repairOrderId, "note_added", actorId, { revisionId, itemCount: items.length });
    return updated;
  });
}

export async function sendRevision(revisionId: number, actorId: number) {
  return db.transaction(async (tx) => {
    const [revision] = await tx.select().from(estimateRevisionsTable).where(eq(estimateRevisionsTable.id, revisionId)).for("update");
    if (!revision) throw new WorkflowError("Revision not found", 404);
    const [[ro], items, sent] = await Promise.all([
      tx.select().from(repairOrdersTable).where(eq(repairOrdersTable.id, revision.repairOrderId)).for("update"),
      tx.select({ id: estimateItemsTable.id }).from(estimateItemsTable).where(eq(estimateItemsTable.estimateRevisionId, revisionId)),
      tx.select({ id: estimateRevisionsTable.id }).from(estimateRevisionsTable).where(and(eq(estimateRevisionsTable.repairOrderId, revision.repairOrderId), eq(estimateRevisionsTable.status, "sent"))).for("update"),
    ]);
    if (revision.status !== "draft" || !canTransitionEstimateRevision(revision.status, "sent")) throw new WorkflowError("Revision cannot be sent", 409);
    if (!items.length) throw new WorkflowError("A revision needs at least one item");
    if (sent.length) throw new WorkflowError("Only one revision may await a decision", 409);
    if (!ro || !canTransitionRepairOrder(ro.status, "awaiting_approval")) throw new WorkflowError("Repair order cannot await approval", 409);
    const token = randomBytes(32).toString("base64url");
    const [updated] = await tx.update(estimateRevisionsTable).set({ status: "sent", publicToken: token, sentAt: new Date(), updatedAt: new Date() }).where(eq(estimateRevisionsTable.id, revisionId)).returning();
    await tx.update(repairOrdersTable).set({ status: "awaiting_approval", version: ro.version + 1, updatedAt: new Date() }).where(eq(repairOrdersTable.id, ro.id));
    await event(tx, ro.id, revision.kind === "supplement" ? "supplement_sent" : "estimate_sent", actorId, { revisionId, priorOperationalStatus: revision.kind === "supplement" ? ro.status : null });
    return updated;
  });
}

export async function decideRevision(token: string, input: { signerName: string; signerEmail?: string | null; decision: "approved" | "declined"; approvedItemIds: number[]; declinedItemIds: number[]; requestIp?: string; requestUserAgent?: string }) {
  return db.transaction(async (tx) => {
    const [revision] = await tx.select().from(estimateRevisionsTable).where(eq(estimateRevisionsTable.publicToken, token)).for("update");
    if (!revision) throw new WorkflowError("Decision link not found", 404);
    if (revision.status !== "sent") throw new WorkflowError("This decision link has already been used", 409);
    if (!input.signerName.trim()) throw new WorkflowError("Signer name is required");
    const [[ro], items] = await Promise.all([tx.select().from(repairOrdersTable).where(eq(repairOrdersTable.id, revision.repairOrderId)).for("update"), tx.select().from(estimateItemsTable).where(eq(estimateItemsTable.estimateRevisionId, revision.id)).orderBy(asc(estimateItemsTable.position))]);
    const approved = new Set(input.approvedItemIds), declined = new Set(input.declinedItemIds), ids = new Set(items.map((item) => item.id));
    if (approved.size + declined.size !== ids.size || [...approved, ...declined].some((id) => !ids.has(id)) || [...approved].some((id) => declined.has(id))) throw new WorkflowError("Every revision item must be decided exactly once");
    if (input.decision === "approved" && !approved.size) throw new WorkflowError("Approved decision requires approved items");
    if (input.decision === "declined" && approved.size) throw new WorkflowError("Declined decision cannot approve items");
    const decision = !approved.size ? "declined" : declined.size ? "partially_approved" : "approved";
    const hash = createHash("sha256").update(JSON.stringify({ revisionId: revision.id, decision, signer: input.signerName, approved: [...approved].sort() })).digest("hex");
    const [approval] = await tx.insert(estimateApprovalsTable).values({ estimateRevisionId: revision.id, decision, signerName: input.signerName.trim(), signerEmail: input.signerEmail ?? null, documentHash: hash, requestIp: input.requestIp ?? null, requestUserAgent: input.requestUserAgent ?? null, decidedAt: new Date() }).returning();
    await tx.insert(estimateApprovalItemsTable).values(items.map((item) => ({ approvalId: approval.id, estimateItemId: item.id, decision: (approved.has(item.id) ? "approved" : "declined") as "approved" | "declined" })));
    if (approved.size) {
      // Positions are aggregate-global, not revision-local.  This prevents a
      // supplement's position 1 from colliding with the original estimate.
      const [{ maxPosition }] = await tx.select({ maxPosition: sql<number>`coalesce(max(${repairOrderWorkItemsTable.position}), 0)::int` })
        .from(repairOrderWorkItemsTable).where(eq(repairOrderWorkItemsTable.repairOrderId, revision.repairOrderId));
      const approvedItems = items.filter((item) => approved.has(item.id));
      const existing = await tx.select().from(repairOrderWorkItemsTable)
        .where(inArray(repairOrderWorkItemsTable.sourceEstimateItemId, approvedItems.map((item) => item.id)));
      const existingBySource = new Map(existing.map((item) => [item.sourceEstimateItemId, item]));
      const missing = approvedItems.filter((item) => !existingBySource.has(item.id));
      if (missing.length) {
        await tx.insert(repairOrderWorkItemsTable).values(missing.map((item, index) => ({
          repairOrderId: revision.repairOrderId, sourceEstimateItemId: item.id,
          position: maxPosition + index + 1, kind: item.kind, description: item.description,
          quantity: item.quantity, unitPrice: item.unitPrice, unitCost: item.unitCost, estimatedHours: item.estimatedHours,
        })));
      }
      if (existing.some((item) => item.repairOrderId !== revision.repairOrderId)) throw new WorkflowError("Authorized source item belongs to another repair order", 409);
    }
    await tx.update(estimateRevisionsTable).set({ status: decision, updatedAt: new Date() }).where(eq(estimateRevisionsTable.id, revision.id));
    if (!ro) throw new WorkflowError("Repair order missing", 409);
    // A supplement pauses an already-authorized workflow only while awaiting a
    // decision.  Its decision must restore that operational state rather than
    // sending an in-progress RO back to diagnosis.
    const hasPerformedWork = revision.kind === "supplement" && (await tx.select({ id: repairOrderWorkItemsTable.id }).from(repairOrderWorkItemsTable).where(and(eq(repairOrderWorkItemsTable.repairOrderId, revision.repairOrderId), eq(repairOrderWorkItemsTable.status, "performed"))).limit(1)).length > 0;
    const nextStatus = revision.kind === "supplement" ? (hasPerformedWork ? "in_progress" : "authorized") : approved.size ? "authorized" : "diagnosing";
    if (!canTransitionRepairOrder(ro.status, nextStatus)) throw new WorkflowError("Repair order cannot transition after decision", 409);
    await tx.update(repairOrdersTable).set({ status: nextStatus, version: ro.version + 1, updatedAt: new Date() }).where(eq(repairOrdersTable.id, ro.id));
    await event(tx, ro.id, revision.kind === "supplement" ? "supplement_decided" : "estimate_decided", null, { revisionId: revision.id, approvalId: approval.id, decision });
    return { revisionId: revision.id, approvalId: approval.id, decision };
  });
}

export async function performWorkItem(workItemId: number, actorId: number, managerOverride = false) {
  return db.transaction(async (tx) => {
    const [work] = await tx.select().from(repairOrderWorkItemsTable).where(eq(repairOrderWorkItemsTable.id, workItemId)).for("update");
    if (!work) throw new WorkflowError("Work item not found", 404);
    const [ro] = await tx.select().from(repairOrdersTable).where(eq(repairOrdersTable.id, work.repairOrderId)).for("update");
    if (!ro) throw new WorkflowError("Repair order not found", 409);
    if (!managerOverride && ro.assignedToId !== actorId) throw new WorkflowError("Only the assigned technician may perform this work", 403);
    if (work.status === "performed") return work;
    if (work.status !== "authorized") throw new WorkflowError("Only authorized work can be performed", 409);
    if (work.kind === "part") {
      const source = await tx.select({ inventoryItemId: estimateItemsTable.inventoryItemId }).from(estimateItemsTable).where(eq(estimateItemsTable.id, work.sourceEstimateItemId)).for("update");
      if (source[0]?.inventoryItemId) {
        const [inventory] = await tx.select().from(inventoryTable).where(eq(inventoryTable.id, source[0].inventoryItemId)).for("update");
        const units = Number(milli(work.quantity) / 1000n);
        if (!inventory || inventory.quantity < units) throw new WorkflowError("Insufficient inventory", 409);
        await tx.insert(stockMovementsTable).values({ inventoryId: inventory.id, delta: -units, reason: "ro_consumed", workItemId, referenceTable: "repair_order_work_items", referenceId: work.repairOrderId, referenceLineId: workItemId, unitCost: work.unitCost, createdById: actorId });
        await tx.update(inventoryTable).set({ quantity: inventory.quantity - units, updatedAt: new Date() }).where(eq(inventoryTable.id, inventory.id));
      }
    }
    const [updated] = await tx.update(repairOrderWorkItemsTable).set({ status: "performed", performedAt: new Date(), performedById: actorId }).where(eq(repairOrderWorkItemsTable.id, workItemId)).returning();
    if (ro.status === "authorized") {
      await tx.update(repairOrdersTable).set({ status: "in_progress", version: ro.version + 1, updatedAt: new Date() }).where(eq(repairOrdersTable.id, ro.id));
      await event(tx, ro.id, "status_changed", actorId, { from: "authorized", to: "in_progress", workItemId });
    }
    await event(tx, work.repairOrderId, "work_performed", actorId, { workItemId });
    return updated;
  });
}

export async function completeRepairOrder(repairOrderId: number, actorId: number) {
  return db.transaction(async (tx) => {
    const [ro] = await tx.select().from(repairOrdersTable).where(eq(repairOrdersTable.id, repairOrderId)).for("update");
    if (!ro) throw new WorkflowError("Repair order not found", 404);
    const [pending, work] = await Promise.all([
      tx.select({ id: estimateRevisionsTable.id }).from(estimateRevisionsTable).where(and(eq(estimateRevisionsTable.repairOrderId, repairOrderId), eq(estimateRevisionsTable.status, "sent"))),
      tx.select({ status: repairOrderWorkItemsTable.status }).from(repairOrderWorkItemsTable).where(eq(repairOrderWorkItemsTable.repairOrderId, repairOrderId)),
    ]);
    if (pending.length || !work.length || work.some((item) => item.status === "authorized") || !work.some((item) => item.status === "performed")) throw new WorkflowError("All authorized work must be performed or voided and at least one item performed", 409);
    if (!canTransitionRepairOrder(ro.status, "completed")) throw new WorkflowError("Repair order cannot be completed", 409);
    const [updated] = await tx.update(repairOrdersTable).set({ status: "completed", completedAt: new Date(), version: ro.version + 1, updatedAt: new Date() }).where(eq(repairOrdersTable.id, repairOrderId)).returning();
    await event(tx, repairOrderId, "ro_completed", actorId);
    return updated;
  });
}

export async function cancelRepairOrder(repairOrderId: number, reason: string, actorId: number) {
  if (!reason.trim()) throw new WorkflowError("Cancellation reason is required");
  return db.transaction(async (tx) => {
    const [ro] = await tx.select().from(repairOrdersTable).where(eq(repairOrdersTable.id, repairOrderId)).for("update");
    if (!ro) throw new WorkflowError("Repair order not found", 404);
    const [invoice] = await tx.select({ id: invoicesTable.id }).from(invoicesTable).where(eq(invoicesTable.repairOrderId, repairOrderId)).for("update");
    if (ro.status === "completed" || invoice) throw new WorkflowError("Completed or invoiced repair orders cannot be cancelled", 409);
    if (!canTransitionRepairOrder(ro.status, "cancelled")) throw new WorkflowError("Repair order cannot be cancelled", 409);
    const [updated] = await tx.update(repairOrdersTable).set({ status: "cancelled", cancelledAt: new Date(), cancellationReason: reason.trim(), version: ro.version + 1, updatedAt: new Date() }).where(eq(repairOrdersTable.id, repairOrderId)).returning();
    await event(tx, repairOrderId, "cancelled", actorId, { reason: reason.trim() });
    return updated;
  });
}

async function recomputeInvoice(tx: Tx, invoice: typeof invoicesTable.$inferSelect) {
  const ledger = await tx.select().from(paymentsTable).where(eq(paymentsTable.invoiceId, invoice.id));
  const successful = ledger.filter((payment) => payment.status === "succeeded").reduce((sum, payment) => sum + cents(payment.amount), 0n);
  const reversed = ledger.filter((payment) => payment.parentPaymentId != null && (payment.status === "refunded" || payment.status === "void")).reduce((sum, payment) => sum + cents(payment.amount), 0n);
  const paid = successful - reversed;
  const balance = cents(invoice.total) - paid;
  const status = invoice.status === "void" ? "void" : paid >= cents(invoice.total) ? "paid" : paid > 0n ? "partially_paid" : "issued";
  const [updated] = await tx.update(invoicesTable).set({ amountPaid: money(paid), balance: money(balance < 0n ? 0n : balance), status, version: invoice.version + 1, updatedAt: new Date() }).where(eq(invoicesTable.id, invoice.id)).returning();
  return updated;
}

export async function createFinalInvoice(repairOrderId: number, actorId: number) {
  return db.transaction(async (tx) => {
    // Serialize the read-before-create sequence. A row lock alone cannot protect
    // the initially-empty invoice set when two finalization requests race.
    await tx.execute(sql`select pg_advisory_xact_lock(${repairOrderId})`);
    const [existing, [ro]] = await Promise.all([
      tx.select().from(invoicesTable).where(eq(invoicesTable.repairOrderId, repairOrderId)).for("update"),
      tx.select().from(repairOrdersTable).where(eq(repairOrdersTable.id, repairOrderId)).for("update"),
    ]);
    if (existing[0]) return existing[0];
    if (!ro) throw new WorkflowError("Repair order not found", 404);
    if (ro.status !== "completed") throw new WorkflowError("Only completed repair orders may be invoiced", 409);
    const [work, [revision]] = await Promise.all([
      tx.select().from(repairOrderWorkItemsTable).where(and(eq(repairOrderWorkItemsTable.repairOrderId, repairOrderId), eq(repairOrderWorkItemsTable.status, "performed"))).orderBy(asc(repairOrderWorkItemsTable.position)),
      tx.select().from(estimateRevisionsTable).where(eq(estimateRevisionsTable.repairOrderId, repairOrderId)).orderBy(desc(estimateRevisionsTable.revisionNo)).limit(1),
    ]);
    if (!work.length || !revision) throw new WorkflowError("Completed repair order has no performed work or revision", 409);
    const totals = calculateInvoiceTotals(work.map((item) => ({ quantityMilli: milli(item.quantity), unitPriceCents: cents(item.unitPrice), kind: item.kind })), BigInt(revision.taxRateBps));
    const [invoice] = await tx.insert(invoicesTable).values({
      repairOrderId, invoiceNumber: `INV-${Date.now()}-${randomBytes(3).toString("hex")}`,
      customerSnapshot: revision.customerSnapshot, vehicleSnapshot: revision.vehicleSnapshot, taxRateBps: revision.taxRateBps,
      subtotal: money(totals.subtotalCents), taxAmount: money(totals.taxCents), total: money(totals.totalCents), balance: money(totals.totalCents),
    }).returning();
    await tx.insert(invoiceItemsTable).values(work.map((item, index) => ({ invoiceId: invoice.id, sourceWorkItemId: item.id, position: index + 1, kind: item.kind, description: item.description, quantity: item.quantity, unitPrice: item.unitPrice, unitCost: item.unitCost, lineTotal: money(lineTotalCents({ quantityMilli: milli(item.quantity), unitPriceCents: cents(item.unitPrice), kind: item.kind })) })));
    await event(tx, repairOrderId, "invoice_created", actorId, { invoiceId: invoice.id });
    return invoice;
  });
}

export async function issueInvoice(invoiceId: number, actorId: number) {
  return db.transaction(async (tx) => {
    const [invoice] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId)).for("update");
    if (!invoice) throw new WorkflowError("Invoice not found", 404);
    if (invoice.status === "issued" || invoice.status === "partially_paid" || invoice.status === "paid") return invoice;
    if (invoice.status !== "draft") throw new WorkflowError("Invoice cannot be issued", 409);
    const [updated] = await tx.update(invoicesTable).set({ status: "issued", publicToken: invoice.publicToken ?? randomBytes(32).toString("base64url"), issuedAt: new Date(), issuedById: actorId, version: invoice.version + 1, updatedAt: new Date() }).where(eq(invoicesTable.id, invoiceId)).returning();
    await event(tx, invoice.repairOrderId, "invoice_issued", actorId, { invoiceId });
    return updated;
  });
}

export async function voidInvoice(invoiceId: number, reason: string, actorId: number) {
  if (!reason.trim()) throw new WorkflowError("Void reason is required");
  return db.transaction(async (tx) => {
    const [invoice] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId)).for("update");
    if (!invoice) throw new WorkflowError("Invoice not found", 404);
    if (invoice.status === "void") return invoice;
    const payments = await tx.select().from(paymentsTable).where(eq(paymentsTable.invoiceId, invoiceId));
    const net = payments.filter((p) => p.status === "succeeded").reduce((s, p) => s + cents(p.amount), 0n) - payments.filter((p) => p.parentPaymentId != null && (p.status === "refunded" || p.status === "void")).reduce((s, p) => s + cents(p.amount), 0n);
    if (net > 0n) throw new WorkflowError("Succeeded payments must be fully reversed before voiding", 409);
    const [updated] = await tx.update(invoicesTable).set({ status: "void", voidedAt: new Date(), voidedById: actorId, voidReason: reason.trim(), version: invoice.version + 1, updatedAt: new Date() }).where(eq(invoicesTable.id, invoiceId)).returning();
    await event(tx, invoice.repairOrderId, "invoice_voided", actorId, { invoiceId, reason: reason.trim() });
    return updated;
  });
}

export async function recordPayment(input: { invoiceId: number; amount: string | number; method: string; attemptKey: string; idempotencyKey: string; processor?: string | null; processorPaymentId?: string | null; referenceNumber?: string | null; pending?: boolean }, actorId: number) {
  if (!input.idempotencyKey || !input.attemptKey || !input.method) throw new WorkflowError("Idempotency-Key, attemptKey, and method are required");
  const amount = cents(input.amount); if (amount <= 0n) throw new WorkflowError("Payment amount must be positive");
  const requestHash = createHash("sha256").update(JSON.stringify({ ...input, amount: money(amount) })).digest("hex");
  return db.transaction(async (tx) => {
    const scope = `payment:${input.invoiceId}`;
    // Prevent concurrent inserts for the same idempotency key from surfacing a
    // database unique-violation instead of replaying the first response.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${scope}), hashtext(${input.idempotencyKey}))`);
    const [key] = await tx.select().from(idempotencyKeysTable).where(and(eq(idempotencyKeysTable.scope, scope), eq(idempotencyKeysTable.key, input.idempotencyKey))).for("update");
    if (key) {
      if (key.requestHash !== requestHash) throw new WorkflowError("Idempotency key was reused with a different request", 409);
      if (key.responseBody) return key.responseBody;
    } else await tx.insert(idempotencyKeysTable).values({ scope, key: input.idempotencyKey, requestHash });
    const [invoice] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, input.invoiceId)).for("update");
    if (!invoice) throw new WorkflowError("Invoice not found", 404);
    const [attempt] = await tx.select().from(paymentsTable).where(and(eq(paymentsTable.invoiceId, input.invoiceId), eq(paymentsTable.attemptKey, input.attemptKey))).for("update");
    if (attempt) {
      const body = { payment: attempt, invoice };
      await tx.update(idempotencyKeysTable).set({ responseStatus: 200, responseBody: body, completedAt: new Date() }).where(and(eq(idempotencyKeysTable.scope, scope), eq(idempotencyKeysTable.key, input.idempotencyKey)));
      return body;
    }
    if (!["issued", "partially_paid"].includes(invoice.status)) throw new WorkflowError("Payments require an issued invoice with a balance", 409);
    if (amount > cents(invoice.balance)) throw new WorkflowError("Payment exceeds invoice balance", 409);
    const status = input.pending ? "pending" : "succeeded";
    const [payment] = await tx.insert(paymentsTable).values({ invoiceId: input.invoiceId, amount: money(amount), status, method: input.method, processor: input.processor ?? null, processorPaymentId: input.processorPaymentId ?? null, attemptKey: input.attemptKey, idempotencyKey: input.idempotencyKey, referenceNumber: input.referenceNumber ?? null, processedAt: status === "succeeded" ? new Date() : null }).returning();
    const updated = status === "succeeded" ? await recomputeInvoice(tx, invoice) : invoice;
    const body = { payment, invoice: updated };
    await tx.update(idempotencyKeysTable).set({ responseStatus: 201, responseBody: body, completedAt: new Date() }).where(and(eq(idempotencyKeysTable.scope, scope), eq(idempotencyKeysTable.key, input.idempotencyKey)));
    await event(tx, invoice.repairOrderId, status === "succeeded" ? "payment_recorded" : "note_added", actorId, { invoiceId: invoice.id, paymentId: payment.id });
    return body;
  });
}

/** Called only after a verified processor event has been durably deduplicated. */
export async function finalizeProcessorPayment(paymentId: number, terminal: "succeeded" | "failed" | "void", processorEventId: string, failureReason?: string | null) {
  return db.transaction(async (tx) => {
    const [payment] = await tx.select().from(paymentsTable).where(eq(paymentsTable.id, paymentId)).for("update");
    if (!payment) throw new WorkflowError("Payment not found", 404);
    const [invoice] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, payment.invoiceId)).for("update");
    if (!invoice) throw new WorkflowError("Invoice not found", 409);
    if (payment.status === terminal) return { payment, invoice };
    if (payment.status !== "pending") throw new WorkflowError("Final payment rows cannot be changed", 409);
    const [updated] = await tx.update(paymentsTable).set({ status: terminal, processorEventId, failureReason: terminal === "failed" ? failureReason ?? "Processor declined payment" : null, processedAt: new Date(), voidedAt: terminal === "void" ? new Date() : null }).where(eq(paymentsTable.id, paymentId)).returning();
    const updatedInvoice = terminal === "succeeded" ? await recomputeInvoice(tx, invoice) : invoice;
    await event(tx, invoice.repairOrderId, terminal === "succeeded" ? "payment_recorded" : "payment_failed", null, { invoiceId: invoice.id, paymentId, processorEventId });
    return { payment: updated, invoice: updatedInvoice };
  });
}

/** Reconcile a verified provider result into the immutable payment ledger. */
export async function reconcileProcessorPayment(input: {
  invoiceId: number; amount: string | number; processor: string; processorPaymentId: string;
  processorEventId: string; method: string; status: "pending" | "succeeded" | "failed"; failureReason?: string | null;
}) {
  const amount = cents(input.amount);
  if (amount <= 0n) throw new WorkflowError("Processor payment amount must be positive");
  return db.transaction(async (tx) => {
    const [invoice] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, input.invoiceId)).for("update");
    if (!invoice) throw new WorkflowError("Invoice not found", 404);
    const [existing] = await tx.select().from(paymentsTable).where(and(
      eq(paymentsTable.processor, input.processor), eq(paymentsTable.processorPaymentId, input.processorPaymentId),
    )).for("update");
    if (existing) {
      if (existing.invoiceId !== invoice.id || cents(existing.amount) !== amount) throw new WorkflowError("Processor payment does not match its invoice", 409);
      if (existing.status === "pending" && input.status !== "pending") {
        const [payment] = await tx.update(paymentsTable).set({
          status: input.status, processorEventId: input.processorEventId,
          failureReason: input.status === "failed" ? input.failureReason ?? "Processor declined payment" : null,
          processedAt: new Date(),
        }).where(eq(paymentsTable.id, existing.id)).returning();
        return { payment, invoice: input.status === "succeeded" ? await recomputeInvoice(tx, invoice) : invoice };
      }
      return { payment: existing, invoice };
    }
    if ((input.status === "succeeded" || input.status === "pending") && amount > cents(invoice.balance)) throw new WorkflowError("Processor payment exceeds invoice balance", 409);
    const [payment] = await tx.insert(paymentsTable).values({
      invoiceId: invoice.id, amount: money(amount), status: input.status, method: input.method,
      processor: input.processor, processorPaymentId: input.processorPaymentId, processorEventId: input.processorEventId,
      attemptKey: `processor:${input.processor}:${input.processorPaymentId}`,
      failureReason: input.status === "failed" ? input.failureReason ?? "Processor declined payment" : null,
      processedAt: input.status === "pending" ? null : new Date(),
    }).returning();
    return { payment, invoice: input.status === "succeeded" ? await recomputeInvoice(tx, invoice) : invoice };
  });
}

/** Records a completed provider refund as a new reversal entry; originals remain immutable. */
export async function reconcileProcessorRefund(input: {
  processor: string; processorPaymentId: string; refundId: string; eventId: string; amount: string | number; reason?: string | null;
}) {
  const amount = cents(input.amount);
  if (amount <= 0n) throw new WorkflowError("Processor refund amount must be positive");
  return db.transaction(async (tx) => {
    const [parent] = await tx.select().from(paymentsTable).where(and(eq(paymentsTable.processor, input.processor), eq(paymentsTable.processorPaymentId, input.processorPaymentId))).for("update");
    if (!parent) throw new WorkflowError("Processor refund has no local payment", 404);
    const [invoice] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, parent.invoiceId)).for("update");
    if (!invoice) throw new WorkflowError("Invoice not found", 409);
    const [existing] = await tx.select().from(paymentsTable).where(and(eq(paymentsTable.processor, input.processor), eq(paymentsTable.processorPaymentId, input.refundId))).for("update");
    if (existing) return { payment: existing, invoice };
    if (parent.status !== "succeeded") throw new WorkflowError("Only succeeded payments may be refunded", 409);
    const reversals = await tx.select().from(paymentsTable).where(eq(paymentsTable.parentPaymentId, parent.id));
    if (amount + reversals.filter((p) => p.status === "refunded" || p.status === "void").reduce((total, p) => total + cents(p.amount), 0n) > cents(parent.amount)) throw new WorkflowError("Refund exceeds payment", 409);
    const [payment] = await tx.insert(paymentsTable).values({
      invoiceId: parent.invoiceId, amount: money(amount), status: "refunded", method: parent.method, processor: input.processor,
      processorPaymentId: input.refundId, processorEventId: input.eventId, parentPaymentId: parent.id,
      attemptKey: `refund:${input.processor}:${input.refundId}`, failureReason: input.reason ?? null, refundedAt: new Date(), processedAt: new Date(),
    }).returning();
    return { payment, invoice: await recomputeInvoice(tx, invoice) };
  });
}

export async function reversePayment(paymentId: number, kind: "refunded" | "void", amountInput: string | number, reason: string, actorId: number) {
  const amount = cents(amountInput);
  if (amount <= 0n || !reason.trim()) throw new WorkflowError("Positive reversal amount and reason are required");
  return db.transaction(async (tx) => {
    const [parent] = await tx.select().from(paymentsTable).where(eq(paymentsTable.id, paymentId)).for("update");
    if (!parent) throw new WorkflowError("Payment not found", 404);
    if (parent.status !== "succeeded") throw new WorkflowError("Only succeeded payments can be reversed", 409);
    const [invoice] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, parent.invoiceId)).for("update");
    if (!invoice) throw new WorkflowError("Invoice not found", 409);
    const reversals = await tx.select().from(paymentsTable).where(eq(paymentsTable.parentPaymentId, paymentId));
    const alreadyReversed = reversals.filter((p) => p.status === "refunded" || p.status === "void").reduce((sum, payment) => sum + cents(payment.amount), 0n);
    if (amount + alreadyReversed > cents(parent.amount)) throw new WorkflowError("Reversal exceeds original payment", 409);
    const [reversal] = await tx.insert(paymentsTable).values({
      invoiceId: parent.invoiceId, amount: money(amount), status: kind, method: parent.method, processor: parent.processor,
      parentPaymentId: parent.id, attemptKey: `${kind}:${parent.id}:${randomBytes(12).toString("hex")}`,
      failureReason: reason.trim(), refundedAt: kind === "refunded" ? new Date() : null, voidedAt: kind === "void" ? new Date() : null, processedAt: new Date(),
    }).returning();
    const updatedInvoice = await recomputeInvoice(tx, invoice);
    await event(tx, invoice.repairOrderId, kind === "refunded" ? "payment_refunded" : "payment_voided", actorId, { invoiceId: invoice.id, paymentId: parent.id, reversalId: reversal.id, reason: reason.trim() });
    return { payment: reversal, invoice: updatedInvoice };
  });
}

/** The aggregate used by repair-order detail screens and workflow APIs. */
export async function getRepairOrderWorkflow(repairOrderId: number) {
  const [repairOrder] = await db.select().from(repairOrdersTable).where(eq(repairOrdersTable.id, repairOrderId));
  if (!repairOrder) throw new WorkflowError("Repair order not found", 404);
  const revisions = await db.select().from(estimateRevisionsTable).where(eq(estimateRevisionsTable.repairOrderId, repairOrderId)).orderBy(asc(estimateRevisionsTable.revisionNo));
  const revisionIds = revisions.map((revision) => revision.id);
  const items = revisionIds.length ? await db.select().from(estimateItemsTable).where(inArray(estimateItemsTable.estimateRevisionId, revisionIds)).orderBy(asc(estimateItemsTable.position)) : [];
  const approvals = revisionIds.length ? await db.select().from(estimateApprovalsTable).where(inArray(estimateApprovalsTable.estimateRevisionId, revisionIds)) : [];
  const approvalIds = approvals.map((approval) => approval.id);
  const approvalItems = approvalIds.length ? await db.select().from(estimateApprovalItemsTable).where(inArray(estimateApprovalItemsTable.approvalId, approvalIds)) : [];
  const [workItems, events, invoices] = await Promise.all([
    db.select().from(repairOrderWorkItemsTable).where(eq(repairOrderWorkItemsTable.repairOrderId, repairOrderId)).orderBy(asc(repairOrderWorkItemsTable.position)),
    db.select().from(repairOrderEventsTable).where(eq(repairOrderEventsTable.repairOrderId, repairOrderId)).orderBy(asc(repairOrderEventsTable.occurredAt)),
    db.select().from(invoicesTable).where(eq(invoicesTable.repairOrderId, repairOrderId)),
  ]);
  const invoice = invoices[0];
  const invoiceItems = invoice ? await db.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.invoiceId, invoice.id)).orderBy(asc(invoiceItemsTable.position)) : [];
  const payments = invoice ? await db.select().from(paymentsTable).where(eq(paymentsTable.invoiceId, invoice.id)) : [];
  return { repairOrder, revisions: revisions.map((revision) => ({ ...revision, items: items.filter((item) => item.estimateRevisionId === revision.id), approval: approvals.find((approval) => approval.estimateRevisionId === revision.id) ?? null })), approvalItems, workItems, invoice: invoice ? { ...invoice, items: invoiceItems, payments } : null, events };
}