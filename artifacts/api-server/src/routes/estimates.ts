import { Router } from "express";
import { db } from "@workspace/db";
import { estimatesTable, lineItemsTable, customersTable, vehiclesTable, invoicesTable, repairOrdersTable, estimateEventsTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { randomBytes } from "crypto";
import { sendSms } from "../lib/sms.js";
import { sendTemplatedEmail } from "../lib/email.js";

const router: Router = Router();

function calcTotals(items: any[], taxRate: number, discount: number) {
  const subtotal = items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.unitPrice), 0);
  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal + taxAmount - discount;
  return { subtotal, taxAmount, total };
}

async function enrichEstimate(estimate: any) {
  const [lineItems, customer, vehicle] = await Promise.all([
    db.select().from(lineItemsTable).where(eq(lineItemsTable.estimateId, estimate.id)),
    db.select().from(customersTable).where(eq(customersTable.id, estimate.customerId)).then(r => r[0]),
    estimate.vehicleId ? db.select().from(vehiclesTable).where(eq(vehiclesTable.id, estimate.vehicleId)).then(r => r[0]) : Promise.resolve(null),
  ]);
  return { ...estimate, lineItems, customer, vehicle };
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

  const { customerId, vehicleId, status, notes, taxRate, discountAmount, lineItems } = req.body;
  const tax = taxRate ?? 0;
  const discount = discountAmount ?? 0;
  const { subtotal, taxAmount, total } = calcTotals(lineItems || [], tax, discount);

  const [estimate] = await db.insert(estimatesTable).values({
    estimateNumber, customerId, vehicleId, status: status || "draft", notes,
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
    })));
  }

  res.status(201).json(await enrichEstimate(estimate));
});

router.get("/:id", async (req, res) => {
  const [estimate] = await db.select().from(estimatesTable).where(eq(estimatesTable.id, Number(req.params.id)));
  if (!estimate) return res.status(404).json({ error: "Estimate not found" });
  res.json(await enrichEstimate(estimate));
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { customerId, vehicleId, status, notes, taxRate, discountAmount, lineItems } = req.body;
  const tax = taxRate ?? 0;
  const discount = discountAmount ?? 0;
  const { subtotal, taxAmount, total } = calcTotals(lineItems || [], tax, discount);

  const [estimate] = await db.update(estimatesTable).set({
    customerId, vehicleId, status, notes,
    taxRate: tax.toString(), taxAmount: taxAmount.toString(), discountAmount: discount.toString(),
    subtotal: subtotal.toString(), total: total.toString(), updatedAt: new Date(),
  }).where(eq(estimatesTable.id, id)).returning();
  if (!estimate) return res.status(404).json({ error: "Estimate not found" });

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
      })));
    }
  }

  res.json(await enrichEstimate(estimate));
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(lineItemsTable).where(eq(lineItemsTable.estimateId, id));
  await db.delete(estimatesTable).where(eq(estimatesTable.id, id));
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
  }
  res.json({ emailed, smsed, channel, errors, estimateUrl, publicToken: token });
});

router.post("/:id/convert", async (req, res) => {
  const id = Number(req.params.id);
  const [estimate] = await db.select().from(estimatesTable).where(eq(estimatesTable.id, id));
  if (!estimate) return res.status(404).json({ error: "Estimate not found" });
  const items = await db.select().from(lineItemsTable).where(eq(lineItemsTable.estimateId, id));

  const [lastInv] = await db.select({ invoiceNumber: invoicesTable.invoiceNumber }).from(invoicesTable).orderBy(desc(invoicesTable.id)).limit(1);
  const nextNum = lastInv ? Number(lastInv.invoiceNumber.replace("INV-", "")) + 1 : 1001;
  const invoiceNumber = `INV-${nextNum}`;

  const [invoice] = await db.insert(invoicesTable).values({
    invoiceNumber, customerId: estimate.customerId, vehicleId: estimate.vehicleId, estimateId: estimate.id,
    status: "draft", notes: estimate.notes,
    subtotal: estimate.subtotal, taxRate: estimate.taxRate, taxAmount: estimate.taxAmount,
    discountAmount: estimate.discountAmount, total: estimate.total,
    amountPaid: "0", balance: estimate.total,
  }).returning();

  if (items.length) {
    await db.insert(lineItemsTable).values(items.map((item) => ({
      invoiceId: invoice.id, type: item.type, description: item.description,
      quantity: item.quantity, unitPrice: item.unitPrice, total: item.total,
      partNumber: item.partNumber,
    })));
  }

  await db.update(estimatesTable).set({ status: "converted", updatedAt: new Date() }).where(eq(estimatesTable.id, id));
  await db.insert(estimateEventsTable).values({
    estimateId: id,
    event: "converted_to_invoice",
    actor: (req as any).user?.username ?? "shop",
    metadata: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber },
  });

  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, invoice.customerId));
  const [vehicle] = invoice.vehicleId ? await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, invoice.vehicleId)) : [null];
  const lineItemsData = await db.select().from(lineItemsTable).where(eq(lineItemsTable.invoiceId, invoice.id));
  res.status(201).json({ ...invoice, lineItems: lineItemsData, payments: [], customer, vehicle });
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
  if (estimate.status === "converted") {
    return res.status(409).json({ error: "Estimate already converted" });
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
  try {
    order = await db.transaction(async (tx) => {
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

      await tx.update(estimatesTable)
        .set({ status: "converted", updatedAt: new Date() })
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
  } catch (err: any) {
    req.log?.error({ err: err?.message, id }, "Estimate convert-to-RO failed");
    return res.status(500).json({ error: "Could not create repair order" });
  }

  res.status(201).json(order);
});

export default router;
