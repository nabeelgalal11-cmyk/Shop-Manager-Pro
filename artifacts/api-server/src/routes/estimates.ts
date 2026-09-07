import { Router } from "express";
import { db } from "@workspace/db";
import { estimatesTable, lineItemsTable, customersTable, vehiclesTable, invoicesTable, repairOrdersTable, estimateEventsTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { randomBytes } from "crypto";
import { sendSms } from "../lib/sms.js";
import { sendTemplatedEmail } from "../lib/email.js";
import { recordActivity } from "../lib/activity.js";

const router: Router = Router();

function calcTotals(items: any[], taxRate: number, discount: number) {
  const subtotal = items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.unitPrice), 0);
  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal + taxAmount - discount;
  return { subtotal, taxAmount, total };
}

async function enrichEstimate(estimate: any) {
  const [lineItems, customer, vehicle, repairOrder, invoices] = await Promise.all([
    db.select().from(lineItemsTable).where(eq(lineItemsTable.estimateId, estimate.id)),
    db.select().from(customersTable).where(eq(customersTable.id, estimate.customerId)).then(r => r[0]),
    estimate.vehicleId ? db.select().from(vehiclesTable).where(eq(vehiclesTable.id, estimate.vehicleId)).then(r => r[0]) : Promise.resolve(null),
    estimate.repairOrderId ? db.select().from(repairOrdersTable).where(eq(repairOrdersTable.id, estimate.repairOrderId)).then(r => r[0] ?? null) : Promise.resolve(null),
    db.select().from(invoicesTable).where(eq(invoicesTable.estimateId, estimate.id)).orderBy(desc(invoicesTable.createdAt)),
  ]);
  return { ...estimate, lineItems, customer, vehicle, repairOrder, invoices };
}

async function validateRepairOrderLink(repairOrderId: unknown, customerId: unknown, vehicleId: unknown) {
  if (repairOrderId === undefined || repairOrderId === null || repairOrderId === "") return { repairOrderId: null };
  const id = Number(repairOrderId);
  if (!Number.isInteger(id) || id <= 0) return { error: "Invalid repairOrderId" };
  const [order] = await db.select().from(repairOrdersTable).where(eq(repairOrdersTable.id, id));
  if (!order) return { error: "Repair order not found" };
  if (Number(customerId) !== Number(order.customerId) || Number(vehicleId) !== Number(order.vehicleId)) {
    return { error: "Estimate customer and vehicle must match the linked repair order" };
  }
  return { repairOrderId: id };
}

async function enrichConvertedInvoice(invoice: any) {
  const [lineItems, customer, vehicle] = await Promise.all([
    db.select().from(lineItemsTable).where(eq(lineItemsTable.invoiceId, invoice.id)),
    db.select().from(customersTable).where(eq(customersTable.id, invoice.customerId)).then(r => r[0] ?? null),
    invoice.vehicleId ? db.select().from(vehiclesTable).where(eq(vehiclesTable.id, invoice.vehicleId)).then(r => r[0] ?? null) : Promise.resolve(null),
  ]);
  return { ...invoice, lineItems, payments: [], customer, vehicle };
}

router.get("/", async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const status = req.query.status as string | undefined;
  const offset = (page - 1) * limit;

  const estimates = await (status
    ? db.select().from(estimatesTable).where(eq(estimatesTable.status, status)).orderBy(desc(estimatesTable.createdAt)).limit(limit).offset(offset)
    : db.select().from(estimatesTable).orderBy(desc(estimatesTable.createdAt)).limit(limit).offset(offset));
  const [countResult] = await db.select({ count: sql<number>`count(*)` }).from(estimatesTable);
  const enriched = await Promise.all(estimates.map(enrichEstimate));
  res.json({ data: enriched, total: Number(countResult.count), page, limit });
});

router.post("/", async (req, res) => {
  const [last] = await db.select({ estimateNumber: estimatesTable.estimateNumber }).from(estimatesTable).orderBy(desc(estimatesTable.id)).limit(1);
  const nextNum = last ? Number(last.estimateNumber.replace("EST-", "")) + 1 : 1001;
  const estimateNumber = `EST-${nextNum}`;

  const { customerId, vehicleId, repairOrderId, status: requestedStatus, notes, taxRate, discountAmount, lineItems } = req.body;
  const status = requestedStatus === "decline" ? "declined" : requestedStatus;
  const link = await validateRepairOrderLink(repairOrderId, customerId, vehicleId);
  if (link.error) return res.status(link.error === "Repair order not found" ? 404 : 400).json({ error: link.error });
  const tax = taxRate ?? 0;
  const discount = discountAmount ?? 0;
  const { subtotal, taxAmount, total } = calcTotals(lineItems || [], tax, discount);

  const [estimate] = await db.insert(estimatesTable).values({
    estimateNumber, customerId, vehicleId, repairOrderId: link.repairOrderId, status: status || "draft", notes,
    taxRate: tax.toString(), taxAmount: taxAmount.toString(), discountAmount: discount.toString(),
    subtotal: subtotal.toString(), total: total.toString(),
  }).returning();

  if (lineItems?.length) {
    await db.insert(lineItemsTable).values(lineItems.map((item: any) => ({
      estimateId: estimate.id,
      type: item.type,
      description: item.description,
      quantity: item.quantity.toString(),
      unitPrice: item.unitPrice.toString(),
      total: (Number(item.quantity) * Number(item.unitPrice)).toString(),
      partNumber: item.partNumber,
      inventoryItemId: item.inventoryItemId,
      unitCost: item.unitCost != null ? item.unitCost.toString() : null,
      customerDecision: item.customerDecision,
      decidedAt: item.decidedAt ? new Date(item.decidedAt) : null,
      warrantyMonths: item.warrantyMonths,
      warrantyMiles: item.warrantyMiles,
    })));
  }

  await recordActivity({
    entityType: "estimate",
    entityId: estimate.id,
    eventType: "created",
    meta: { estimateNumber: estimate.estimateNumber, total: Number(estimate.total) },
    customerId: estimate.customerId ?? null,
    req,
  });

  res.status(201).json(await enrichEstimate(estimate));
});

router.get("/:id", async (req, res) => {
  const [estimate] = await db.select().from(estimatesTable).where(eq(estimatesTable.id, Number(req.params.id)));
  if (!estimate) return res.status(404).json({ error: "Estimate not found" });
  res.json(await enrichEstimate(estimate));
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { customerId, vehicleId, repairOrderId, status: requestedStatus, notes, taxRate, discountAmount, lineItems } = req.body;
  const status = requestedStatus === "decline" ? "declined" : requestedStatus;
  const tax = taxRate ?? 0;
  const discount = discountAmount ?? 0;
  const { subtotal, taxAmount, total } = calcTotals(lineItems || [], tax, discount);

  const [prev] = await db.select().from(estimatesTable).where(eq(estimatesTable.id, id));
  if (!prev) return res.status(404).json({ error: "Estimate not found" });
  const effectiveCustomerId = customerId ?? prev.customerId;
  const effectiveVehicleId = vehicleId !== undefined ? vehicleId : prev.vehicleId;
  const effectiveRepairOrderId = repairOrderId !== undefined ? repairOrderId : prev.repairOrderId;
  const link = await validateRepairOrderLink(effectiveRepairOrderId, effectiveCustomerId, effectiveVehicleId);
  if (link.error) return res.status(link.error === "Repair order not found" ? 404 : 400).json({ error: link.error });
  const [estimate] = await db.update(estimatesTable).set({
    customerId: effectiveCustomerId, vehicleId: effectiveVehicleId, repairOrderId: link.repairOrderId, status, notes,
    taxRate: tax.toString(), taxAmount: taxAmount.toString(), discountAmount: discount.toString(),
    subtotal: subtotal.toString(), total: total.toString(), updatedAt: new Date(),
  }).where(eq(estimatesTable.id, id)).returning();
  if (!estimate) return res.status(404).json({ error: "Estimate not found" });

  if (status !== undefined && prev && status !== prev.status) {
    await recordActivity({
      entityType: "estimate",
      entityId: estimate.id,
      eventType: "status_changed",
      meta: { from: prev.status ?? null, to: estimate.status },
      customerId: estimate.customerId ?? null,
      req,
    });
  }
  await recordActivity({
    entityType: "estimate",
    entityId: estimate.id,
    eventType: "updated",
    meta: { total: Number(estimate.total) },
    customerId: estimate.customerId ?? null,
    req,
  });

  if (lineItems) {
    await db.delete(lineItemsTable).where(eq(lineItemsTable.estimateId, id));
    if (lineItems.length) {
      await db.insert(lineItemsTable).values(lineItems.map((item: any) => ({
        estimateId: id,
        type: item.type,
        description: item.description,
        quantity: item.quantity.toString(),
        unitPrice: item.unitPrice.toString(),
        total: (Number(item.quantity) * Number(item.unitPrice)).toString(),
        partNumber: item.partNumber,
        inventoryItemId: item.inventoryItemId,
        unitCost: item.unitCost != null ? item.unitCost.toString() : null,
        customerDecision: item.customerDecision,
        decidedAt: item.decidedAt ? new Date(item.decidedAt) : null,
        warrantyMonths: item.warrantyMonths,
        warrantyMiles: item.warrantyMiles,
      })));
    }
  }

  res.json(await enrichEstimate(estimate));
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(estimatesTable).where(eq(estimatesTable.id, id));
  await db.delete(lineItemsTable).where(eq(lineItemsTable.estimateId, id));
  await db.delete(estimatesTable).where(eq(estimatesTable.id, id));
  if (existing) {
    await recordActivity({
      entityType: "estimate",
      entityId: id,
      eventType: "deleted",
      meta: { estimateNumber: existing.estimateNumber },
      customerId: existing.customerId ?? null,
      req,
    });
  }
  res.status(204).send();
});

/**
 * Send the estimate to the customer over their preferred channel(s).
 * Mints a public approval token (idempotent) and includes a link in the
 * email/SMS so the customer can review + e-sign. Marks status -> "sent".
 */
router.post("/:id/send", async (req, res) => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(estimatesTable).where(eq(estimatesTable.id, id));
  if (!existing) return res.status(404).json({ error: "Estimate not found" });
  // Don't downgrade or re-open terminal states. Re-quoting requires a new
  // estimate (out of scope per task spec).
  if (existing.status === "approved" || existing.status === "declined" || existing.status === "converted") {
    return res.status(409).json({ error: `Estimate is ${existing.status} and cannot be re-sent. Create a new estimate to re-quote.` });
  }
  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, existing.customerId));
  if (!customer) return res.status(404).json({ error: "Customer not found" });

  // Mint a token if missing — preserves the link if the writer re-sends.
  const token = existing.publicToken ?? randomBytes(24).toString("base64url");
  if (!existing.publicToken) {
    await db.update(estimatesTable)
      .set({ publicToken: token, updatedAt: new Date() })
      .where(eq(estimatesTable.id, id));
  }

  const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "")
    || (req.headers["x-forwarded-host"] && `${req.protocol}://${req.headers["x-forwarded-host"]}`)
    || `${req.protocol}://${req.get("host")}`;
  const estimateUrl = `${base}/estimate/${token}`;

  const channel = (customer.preferredChannel as "email" | "sms" | "both") ?? "email";
  const wantsEmail = channel === "email" || channel === "both";
  const wantsSms = channel === "sms" || channel === "both";
  const total = `$${Number(existing.total).toFixed(2)}`;
  const shop = process.env.SHOP_NAME || "Our Shop";

  let emailed = false, smsed = false;
  const errors: string[] = [];

  if (wantsEmail) {
    if (!customer.email) errors.push("no email on file");
    else {
      const r = await sendTemplatedEmail("estimate_sent", customer.email, {
        customerName: `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim() || "Customer",
        customerEmail: customer.email,
        shopName: shop,
        estimateNumber: existing.estimateNumber,
        total,
        estimateUrl,
      });
      emailed = !!r.ok;
      if (!r.ok) errors.push(`email: ${r.error || "failed"}`);
    }
  }
  if (wantsSms) {
    const smsBody = `${shop}: Estimate ${existing.estimateNumber} for ${total} is ready — review & approve: ${estimateUrl} Reply STOP to opt out.`;
    const r = await sendSms({ customerId: customer.id, body: smsBody, estimateId: existing.id });
    smsed = r.ok;
    if (!r.ok) errors.push(`sms: ${r.error || r.reason || "failed"}`);
  }

  if (emailed || smsed) {
    await db.update(estimatesTable)
      .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
      .where(eq(estimatesTable.id, id));
    await db.insert(estimateEventsTable).values({
      estimateId: id,
      event: "sent",
      actor: (req as any).user?.username ?? "shop",
      metadata: { emailed, smsed, channel, estimateUrl },
    });
    await recordActivity({
      entityType: "estimate",
      entityId: id,
      eventType: "estimate_sent",
      meta: { emailed, smsed, channel },
      customerId: existing.customerId ?? null,
      req,
    });
    if (emailed) {
      await recordActivity({
        entityType: "estimate",
        entityId: id,
        eventType: "email_sent",
        meta: { template: "estimate_sent", to: customer.email },
        customerId: existing.customerId ?? null,
        req,
      });
    }
    if (smsed) {
      await recordActivity({
        entityType: "estimate",
        entityId: id,
        eventType: "sms_sent",
        meta: { context: "estimate_sent" },
        customerId: existing.customerId ?? null,
        req,
      });
    }
  }
  res.json({ emailed, smsed, channel, errors, estimateUrl, publicToken: token });
});

router.post("/:id/convert", async (req, res) => {
  const id = Number(req.params.id);
  let result: { invoice: any; estimate: any; created: boolean };
  try {
    result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM estimates WHERE id = ${id} FOR UPDATE`);
      const [estimate] = await tx.select().from(estimatesTable).where(eq(estimatesTable.id, id));
      if (!estimate) throw Object.assign(new Error("Estimate not found"), { status: 404 });

      const [existingInvoice] = await tx.select().from(invoicesTable)
        .where(eq(invoicesTable.estimateId, id)).orderBy(desc(invoicesTable.id)).limit(1);
      if (existingInvoice) return { invoice: existingInvoice, estimate, created: false };

      if (estimate.status !== "approved" && !(estimate.status === "converted" && estimate.repairOrderId)) {
        throw Object.assign(new Error(`Only approved estimates, or estimates converted to a repair order, can be invoiced (current status: ${estimate.status}).`), { status: 409 });
      }

      const items = await tx.select().from(lineItemsTable).where(eq(lineItemsTable.estimateId, id));
      const [customer] = await tx.select().from(customersTable).where(eq(customersTable.id, estimate.customerId));
      const isExempt = customer?.taxExempt === true;
      const effectiveTaxRate = isExempt ? 0 : Number(estimate.taxRate ?? 0);
      const discount = Number(estimate.discountAmount ?? 0);
      const subtotal = Number(estimate.subtotal ?? 0);
      const taxAmount = subtotal * (effectiveTaxRate / 100);
      const total = subtotal + taxAmount - discount;
      const [lastInv] = await tx.select({ invoiceNumber: invoicesTable.invoiceNumber }).from(invoicesTable).orderBy(desc(invoicesTable.id)).limit(1);
      const nextNum = lastInv ? Number(lastInv.invoiceNumber.replace("INV-", "")) + 1 : 1001;

      const [invoice] = await tx.insert(invoicesTable).values({
        invoiceNumber: `INV-${nextNum}`, customerId: estimate.customerId, vehicleId: estimate.vehicleId,
        repairOrderId: estimate.repairOrderId, estimateId: estimate.id,
        status: "draft", notes: estimate.notes,
        subtotal: subtotal.toString(), taxRate: effectiveTaxRate.toString(), taxAmount: taxAmount.toString(),
        discountAmount: discount.toString(), total: total.toString(),
        amountPaid: "0", balance: total.toString(),
        taxExempt: isExempt, taxExemptNumber: customer?.taxExemptNumber ?? null,
      }).returning();

      if (items.length) {
        await tx.insert(lineItemsTable).values(items.map((item) => ({
          invoiceId: invoice.id, type: item.type, description: item.description,
          quantity: item.quantity, unitPrice: item.unitPrice, total: item.total,
          partNumber: item.partNumber, inventoryItemId: item.inventoryItemId,
          unitCost: item.unitCost, customerDecision: item.customerDecision,
          decidedAt: item.decidedAt, warrantyMonths: item.warrantyMonths,
          warrantyMiles: item.warrantyMiles,
        })));
      }
      await tx.update(estimatesTable).set({ status: "converted", updatedAt: new Date() }).where(eq(estimatesTable.id, id));
      await tx.insert(estimateEventsTable).values({
        estimateId: id, event: "converted_to_invoice",
        actor: (req as any).user?.username ?? "shop",
        metadata: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber },
      });
      return { invoice, estimate, created: true };
    });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    req.log?.error({ err, id }, "Estimate convert-to-invoice transaction failed");
    return res.status(500).json({ error: "Could not create invoice" });
  }

  const { invoice, estimate, created } = result;
  if (!created) return res.json(await enrichConvertedInvoice(invoice));

  await recordActivity({
    entityType: "estimate",
    entityId: id,
    eventType: "estimate_converted",
    meta: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, target: "invoice" },
    customerId: estimate.customerId,
    req,
  });
  await recordActivity({
    entityType: "invoice",
    entityId: invoice.id,
    eventType: "created",
    meta: { invoiceNumber: invoice.invoiceNumber, fromEstimate: id, fromEstimateNumber: estimate.estimateNumber },
    customerId: estimate.customerId,
    req,
  });

  res.status(201).json(await enrichConvertedInvoice(invoice));
});

/**
 * Convert an approved estimate into a Repair Order, carrying over only the
 * line items the customer approved. Labor rolls up into estimatedHours-aware
 * fields; parts (and any approved labor/fee rows) are mapped into the RO's
 * `parts` jsonb so the writer can see them on the RO detail page.
 */
router.post("/:id/convert-to-ro", async (req, res) => {
  const id = Number(req.params.id);
  const [estimate] = await db.select().from(estimatesTable).where(eq(estimatesTable.id, id));
  if (!estimate) return res.status(404).json({ error: "Estimate not found" });
  if (estimate.repairOrderId) {
    const [existing] = await db.select().from(repairOrdersTable).where(eq(repairOrdersTable.id, estimate.repairOrderId));
    if (existing) return res.json(existing);
  }
  // Convert is a post-approval action. Don't allow it for draft/sent/declined.
  if (estimate.status !== "approved") {
    return res.status(409).json({ error: `Only approved estimates can be converted to a repair order (current status: ${estimate.status}).` });
  }
  if (!estimate.vehicleId) {
    return res.status(400).json({ error: "Estimate has no vehicle attached" });
  }

  const items = await db.select().from(lineItemsTable).where(eq(lineItemsTable.estimateId, id));
  const approved = items.filter(i => i.customerDecision === "approved");
  if (approved.length === 0) {
    return res.status(400).json({ error: "No approved line items to convert. The customer has not approved any work." });
  }

  // Build RO parts from approved items. Labor + fees are kept in the parts
  // array so the writer sees the full context; description is prefixed so
  // the source line type is unambiguous.
  const parts = approved.map(i => ({
    name: i.type === "labor" ? `[Labor] ${i.description}` : i.description,
    partNumber: i.partNumber ?? undefined,
    quantity: Number(i.quantity),
    unitPrice: Number(i.unitPrice),
    inventoryId: i.inventoryItemId ?? undefined,
    unitCost: i.unitCost != null ? Number(i.unitCost) : undefined,
  }));

  // Sum approved labor lines into estimatedHours so the RO carries the
  // expected work commitment, not just parts.
  const estimatedHours = approved
    .filter(i => i.type === "labor")
    .reduce((s, i) => s + Number(i.quantity), 0);

  let order: any;
  let createdNew = false;
  try {
    order = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM estimates WHERE id = ${id} FOR UPDATE`);
      const [lockedEstimate] = await tx.select().from(estimatesTable).where(eq(estimatesTable.id, id));
      if (!lockedEstimate) throw new Error("Estimate disappeared during conversion");
      if (lockedEstimate.repairOrderId) {
        const [existing] = await tx.select().from(repairOrdersTable).where(eq(repairOrdersTable.id, lockedEstimate.repairOrderId));
        if (existing) return existing;
      }
      if (lockedEstimate.status !== "approved") {
        throw Object.assign(new Error(`Only approved estimates can be converted to a repair order (current status: ${lockedEstimate.status}).`), { status: 409 });
      }
      const [last] = await tx.select({ orderNumber: repairOrdersTable.orderNumber })
        .from(repairOrdersTable).orderBy(desc(repairOrdersTable.id)).limit(1);
      const nextRoNum = last ? Number(last.orderNumber.replace("RO-", "")) + 1 : 1001;
      const orderNumber = `RO-${nextRoNum}`;

      const [created] = await tx.insert(repairOrdersTable).values({
        orderNumber,
        customerId: estimate.customerId,
        vehicleId: estimate.vehicleId,
        status: "pending",
        priority: "normal",
        complaint: estimate.notes ?? `From estimate ${estimate.estimateNumber}`,
        notes: `Created from approved estimate ${estimate.estimateNumber}`,
        parts,
        estimatedHours: estimatedHours > 0 ? estimatedHours.toFixed(2) : null,
      }).returning();
      createdNew = true;

      await tx.update(estimatesTable)
        .set({ status: "converted", repairOrderId: created.id, updatedAt: new Date() })
        .where(eq(estimatesTable.id, id));

      await tx.insert(estimateEventsTable).values({
        estimateId: id,
        event: "converted_to_ro",
        actor: (req as any).user?.username ?? "shop",
        metadata: {
          repairOrderId: created.id,
          orderNumber: created.orderNumber,
          approvedLineCount: approved.length,
          estimatedHours,
        },
      });

      return created;
    });
    if (createdNew) await recordActivity({
      entityType: "estimate",
      entityId: id,
      eventType: "estimate_converted",
      meta: { repairOrderId: order.id, orderNumber: order.orderNumber, approvedLineCount: approved.length, target: "repair_order" },
      customerId: estimate.customerId ?? null,
      req,
    });
    if (createdNew) await recordActivity({
      entityType: "repair_order",
      entityId: order.id,
      eventType: "created",
      meta: { fromEstimateId: id, fromEstimateNumber: estimate.estimateNumber, orderNumber: order.orderNumber },
      customerId: estimate.customerId ?? null,
      req,
    });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    req.log?.error({ err: err?.message, id }, "Estimate convert-to-RO failed");
    return res.status(500).json({ error: "Could not create repair order" });
  }

  res.status(createdNew ? 201 : 200).json(order);
});

export default router;
