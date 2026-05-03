import { Router } from "express";
import { randomBytes } from "crypto";
import type Stripe from "stripe";
import { db } from "@workspace/db";
import { invoicesTable, lineItemsTable, paymentsTable, customersTable, vehiclesTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { sendTemplatedEmail } from "../lib/email.js";
import { sendSms } from "../lib/sms.js";
import { applyStockMovement, reverseStockMovement, getInventoryUnitCost, type DbExecutor } from "../lib/inventory.js";
import { getStripeClient, getStripeSettings } from "../lib/stripe.js";

const CONSUMPTION_STATUSES = new Set(["sent", "paid"]);

async function applyInvoiceConsumption(invoiceId: number, executor: DbExecutor = db) {
  const items = await executor.select().from(lineItemsTable).where(eq(lineItemsTable.invoiceId, invoiceId));
  for (const li of items) {
    const invId = Number(li.inventoryItemId);
    if (!Number.isFinite(invId) || invId <= 0) continue;
    const qty = Math.round(Number(li.quantity));
    if (!Number.isFinite(qty) || qty === 0) continue;
    const unitCost = li.unitCost ?? await getInventoryUnitCost(invId, executor);
    await applyStockMovement({
      inventoryId: invId,
      delta: -qty,
      reason: "invoice_consumed",
      referenceTable: "invoices",
      referenceId: invoiceId,
      referenceLineId: li.id,
      unitCost,
    }, executor);
  }
}

async function reverseInvoiceConsumption(invoiceId: number, executor: DbExecutor = db) {
  const items = await executor.select().from(lineItemsTable).where(eq(lineItemsTable.invoiceId, invoiceId));
  for (const li of items) {
    const invId = Number(li.inventoryItemId);
    if (!Number.isFinite(invId) || invId <= 0) continue;
    await reverseStockMovement({
      inventoryId: invId,
      originalReason: "invoice_consumed",
      reverseReason: "invoice_unconsumed",
      referenceTable: "invoices",
      referenceId: invoiceId,
      referenceLineId: li.id,
    }, executor);
  }
}

const router: Router = Router();

function vehicleInfoStr(vehicle: any): string {
  if (!vehicle) return "Not specified";
  const base = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ");
  return base + (vehicle.licensePlate ? ` (${vehicle.licensePlate})` : "");
}

function customerName(customer: any): string {
  return `${customer?.firstName ?? ""} ${customer?.lastName ?? ""}`.trim() || "Customer";
}

async function maybeSendInvoiceEmail(prevStatus: string | null, invoice: any, req: any) {
  try {
    if (invoice.status !== "sent") return;
    if (prevStatus === "sent") return;
    const customer = invoice.customer;
    const channel = (customer?.preferredChannel as "email" | "sms" | "both") ?? "email";
    const wantsEmail = channel === "email" || channel === "both";
    const wantsSms = channel === "sms" || channel === "both";

    // Build pay link once for both channels.
    let payUrl: string | null = null;
    try {
      const balance = Number(invoice.balance);
      if (Number.isFinite(balance) && balance > 0) {
        const { secretKey } = await getStripeSettings();
        if (secretKey) {
          const token = await ensurePublicToken(invoice.id);
          const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "")
            || (req.headers?.["x-forwarded-host"] && `${req.protocol}://${req.headers["x-forwarded-host"]}`)
            || `${req.protocol}://${req.get?.("host")}`;
          payUrl = `${base}/pay/${token}`;
        }
      }
    } catch (err) {
      req.log?.warn({ err, id: invoice.id }, "Failed to build pay link");
    }

    if (wantsSms) {
      const smsBody = `${process.env.SHOP_NAME || "Our Shop"}: Invoice ${invoice.invoiceNumber} for $${Number(invoice.total).toFixed(2)} is ready.${payUrl ? ` Pay: ${payUrl}` : ""} Reply STOP to opt out.`;
      const { sendSms } = await import("../lib/sms.js");
      await sendSms({ customerId: invoice.customerId, body: smsBody, invoiceId: invoice.id });
    }

    if (!wantsEmail) return;
    if (!customer?.email) {
      req.log?.info({ id: invoice.id }, "No customer email; skipping invoice email");
      return;
    }

    let payLinkSection = "";
    if (payUrl) {
      payLinkSection = `<div style="text-align: center; margin: 24px 0;">
          <a href="${payUrl}" style="display: inline-block; background: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold;">Pay online</a>
          <p style="color: #6b7280; font-size: 13px; margin-top: 8px;">Or paste this link into your browser:<br><span style="word-break: break-all;">${payUrl}</span></p>
        </div>`;
    }

    const result = await sendTemplatedEmail("invoice_sent", customer.email, {
      customerName: customerName(customer),
      customerEmail: customer.email,
      shopName: process.env.SHOP_NAME || "Our Shop",
      invoiceNumber: invoice.invoiceNumber,
      total: `$${Number(invoice.total).toFixed(2)}`,
      balance: `$${Number(invoice.balance).toFixed(2)}`,
      dueDate: invoice.dueDate || "On receipt",
      vehicleInfo: vehicleInfoStr(invoice.vehicle),
      payLinkSection,
    });
    if (!result.ok) req.log?.warn({ err: result.error, id: invoice.id }, "Invoice email failed");
  } catch (err) {
    req.log?.error({ err }, "maybeSendInvoiceEmail crashed");
  }
}

async function enrichInvoice(invoice: any) {
  const [lineItems, payments, customer, vehicle] = await Promise.all([
    db.select().from(lineItemsTable).where(eq(lineItemsTable.invoiceId, invoice.id)),
    db.select().from(paymentsTable).where(eq(paymentsTable.invoiceId, invoice.id)),
    db.select().from(customersTable).where(eq(customersTable.id, invoice.customerId)).then(r => r[0]),
    invoice.vehicleId ? db.select().from(vehiclesTable).where(eq(vehiclesTable.id, invoice.vehicleId)).then(r => r[0]) : Promise.resolve(null),
  ]);
  return { ...invoice, lineItems, payments, customer, vehicle };
}

function calcTotals(items: any[], taxRate: number, discount: number) {
  const subtotal = items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.unitPrice), 0);
  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal + taxAmount - discount;
  return { subtotal, taxAmount, total };
}

router.get("/", async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const status = req.query.status as string | undefined;
  const offset = (page - 1) * limit;

  const invoices = await (status
    ? db.select().from(invoicesTable).where(eq(invoicesTable.status, status)).orderBy(desc(invoicesTable.createdAt)).limit(limit).offset(offset)
    : db.select().from(invoicesTable).orderBy(desc(invoicesTable.createdAt)).limit(limit).offset(offset));
  const [countResult] = await db.select({ count: sql<number>`count(*)` }).from(invoicesTable);
  const enriched = await Promise.all(invoices.map(enrichInvoice));
  res.json({ data: enriched, total: Number(countResult.count), page, limit });
});

router.post("/", async (req, res) => {
  const { customerId, vehicleId, repairOrderId, estimateId, status, notes, taxRate, discountAmount, dueDate, lineItems } = req.body;
  const tax = taxRate ?? 0;
  const discount = discountAmount ?? 0;
  const { subtotal, taxAmount, total } = calcTotals(lineItems || [], tax, discount);

  let invoice: any;
  try {
    invoice = await db.transaction(async (tx) => {
      const [last] = await tx.select({ invoiceNumber: invoicesTable.invoiceNumber }).from(invoicesTable).orderBy(desc(invoicesTable.id)).limit(1);
      const nextNum = last ? Number(last.invoiceNumber.replace("INV-", "")) + 1 : 1001;
      const invoiceNumber = `INV-${nextNum}`;

      const [created] = await tx.insert(invoicesTable).values({
        invoiceNumber, customerId, vehicleId, repairOrderId, estimateId, status: status || "draft", notes,
        taxRate: tax.toString(), taxAmount: taxAmount.toString(), discountAmount: discount.toString(),
        subtotal: subtotal.toString(), total: total.toString(), amountPaid: "0", balance: total.toString(),
        dueDate,
      }).returning();

      if (lineItems?.length) {
        await tx.insert(lineItemsTable).values(lineItems.map((item: any) => ({
          invoiceId: created.id,
          type: item.type,
          description: item.description,
          quantity: item.quantity.toString(),
          unitPrice: item.unitPrice.toString(),
          total: (Number(item.quantity) * Number(item.unitPrice)).toString(),
          partNumber: item.partNumber,
          inventoryItemId: item.inventoryItemId ?? null,
          unitCost: item.unitCost != null ? String(item.unitCost) : null,
        })));
      }

      if (CONSUMPTION_STATUSES.has(created.status)) {
        await applyInvoiceConsumption(created.id, tx);
      }

      return created;
    });
  } catch (err) {
    req.log?.error({ err }, "Invoice create transaction failed");
    return res.status(500).json({ error: "Failed to create invoice" });
  }

  const enriched = await enrichInvoice(invoice);
  await maybeSendInvoiceEmail(null, enriched, req);
  res.status(201).json(enriched);
});

router.get("/:id", async (req, res) => {
  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, Number(req.params.id)));
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  res.json(await enrichInvoice(invoice));
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { customerId, vehicleId, status, notes, taxRate, discountAmount, dueDate, lineItems } = req.body;
  const tax = taxRate ?? 0;
  const discount = discountAmount ?? 0;
  const { subtotal, taxAmount, total } = calcTotals(lineItems || [], tax, discount);

  type Result =
    | { kind: "ok"; invoice: any; prevStatus: string | null }
    | { kind: "error"; status: number; error: string };

  let result: Result;
  try {
    result = await db.transaction(async (tx): Promise<Result> => {
      const [prev] = await tx.select({ status: invoicesTable.status }).from(invoicesTable).where(eq(invoicesTable.id, id));
      const existingPayments = await tx.select().from(paymentsTable).where(eq(paymentsTable.invoiceId, id));
      const amountPaid = existingPayments.reduce((sum, p) => sum + Number(p.amount), 0);
      const balance = total - amountPaid;

      const [invoice] = await tx.update(invoicesTable).set({
        customerId, vehicleId, status, notes,
        taxRate: tax.toString(), taxAmount: taxAmount.toString(), discountAmount: discount.toString(),
        subtotal: subtotal.toString(), total: total.toString(), amountPaid: amountPaid.toString(), balance: balance.toString(),
        dueDate, updatedAt: new Date(),
      }).where(eq(invoicesTable.id, id)).returning();
      if (!invoice) return { kind: "error", status: 404, error: "Invoice not found" };

      const wasConsumed = prev && CONSUMPTION_STATUSES.has(prev.status);
      const isConsumed = CONSUMPTION_STATUSES.has(invoice.status);

      if (lineItems) {
        if (wasConsumed) await reverseInvoiceConsumption(id, tx);
        await tx.delete(lineItemsTable).where(eq(lineItemsTable.invoiceId, id));
        if (lineItems.length) {
          await tx.insert(lineItemsTable).values(lineItems.map((item: any) => ({
            invoiceId: id, type: item.type, description: item.description,
            quantity: item.quantity.toString(), unitPrice: item.unitPrice.toString(),
            total: (Number(item.quantity) * Number(item.unitPrice)).toString(), partNumber: item.partNumber,
            inventoryItemId: item.inventoryItemId ?? null,
            unitCost: item.unitCost != null ? String(item.unitCost) : null,
          })));
        }
        if (isConsumed) await applyInvoiceConsumption(id, tx);
      } else {
        if (!wasConsumed && isConsumed) await applyInvoiceConsumption(id, tx);
        else if (wasConsumed && !isConsumed) await reverseInvoiceConsumption(id, tx);
      }

      return { kind: "ok", invoice, prevStatus: prev?.status ?? null };
    });
  } catch (err) {
    req.log?.error({ err, id }, "Invoice update transaction failed");
    return res.status(500).json({ error: "Failed to update invoice" });
  }

  if (result.kind === "error") return res.status(result.status).json({ error: result.error });

  const enriched = await enrichInvoice(result.invoice);
  await maybeSendInvoiceEmail(result.prevStatus, enriched, req);
  res.json(enriched);
});

async function ensurePublicToken(invoiceId: number): Promise<string> {
  const [row] = await db.select({ publicToken: invoicesTable.publicToken }).from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
  if (row?.publicToken) return row.publicToken;
  const token = randomBytes(24).toString("base64url");
  await db.update(invoicesTable).set({ publicToken: token, updatedAt: new Date() }).where(eq(invoicesTable.id, invoiceId));
  return token;
}

// Generate (or fetch) the public pay link for an invoice. Used by the
// admin "Send pay link" affordance. Only `sent` invoices are payable online —
// drafts are not yet finalized, paid/void shouldn't be charged again.
router.post("/:id/pay-link", async (req, res) => {
  const id = Number(req.params.id);
  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  if (invoice.status !== "sent") {
    return res.status(400).json({ error: "Pay links are only available for sent invoices" });
  }
  const token = await ensurePublicToken(id);
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "")
    || (req.headers["x-forwarded-host"] && `${req.protocol}://${req.headers["x-forwarded-host"]}`)
    || `${req.protocol}://${req.get("host")}`;
  res.json({ token, url: `${base}/pay/${token}` });
});

// Send the pay link via SMS. Generates the token if missing and texts the
// customer a short message with the public link. Idempotent on Twilio's side
// (status callback updates the messages row asynchronously).
router.post("/:id/pay-link-sms", async (req, res) => {
  const id = Number(req.params.id);
  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  if (invoice.status !== "sent") {
    return res.status(400).json({ error: "Pay links are only available for sent invoices" });
  }
  const token = await ensurePublicToken(id);
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "")
    || (req.headers["x-forwarded-host"] && `${req.protocol}://${req.headers["x-forwarded-host"]}`)
    || `${req.protocol}://${req.get("host")}`;
  const url = `${base}/pay/${token}`;
  const shopName = process.env.SHOP_NAME || "Our Shop";
  const body = `${shopName}: Invoice ${invoice.invoiceNumber} ($${Number(invoice.balance).toFixed(2)}) is ready. Pay online: ${url} — Reply STOP to opt out.`;
  const result = await sendSms({
    customerId: invoice.customerId,
    body,
    invoiceId: id,
    sentByUserId: (req as any).user?.id ?? null,
  });
  if (!result.ok) {
    const status =
      result.reason === "not_configured" ? 503 :
      result.reason === "no_phone" ? 400 :
      result.reason === "opted_out" ? 409 :
      500;
    return res.status(status).json({ error: result.error, reason: result.reason });
  }
  res.json({ ok: true, url, messageId: result.messageId });
});

// Create a Stripe Checkout Session for an invoice (called by both the admin UI
// and the public pay page; the public-side wrapper lives in routes/public.ts).
export async function createCheckoutSessionForInvoice(invoiceId: number, baseUrl: string) {
  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
  if (!invoice) throw Object.assign(new Error("Invoice not found"), { status: 404 });
  const balance = Number(invoice.balance);
  if (!(balance > 0)) throw Object.assign(new Error("Invoice has no outstanding balance"), { status: 400 });
  // Online checkout is only allowed for invoices that have been sent. Drafts
  // are not finalized; paid/void invoices must not be charged again.
  if (invoice.status !== "sent") {
    throw Object.assign(new Error(`Invoice is ${invoice.status} and cannot be paid online`), { status: 400 });
  }

  const token = invoice.publicToken ?? await ensurePublicToken(invoiceId);
  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, invoice.customerId));
  // Refuse to start a checkout without a webhook secret — otherwise Stripe
  // could collect the payment and we'd never auto-mark the invoice paid.
  const { webhookSecret, achEnabled } = await getStripeSettings();
  if (!webhookSecret) {
    throw Object.assign(new Error("Stripe webhook signing secret not configured. Add it in Settings → Payments."), { status: 503 });
  }
  const stripe = await getStripeClient();
  const amountCents = Math.round(balance * 100);
  // Card covers Apple Pay/Google Pay automatically in Stripe Checkout when
  // those are enabled in the Stripe dashboard. Link is included so returning
  // customers get one-click pay. ACH (us_bank_account) is opt-in per shop
  // because it has multi-day settlement and the shop may not want to wait
  // for funds to clear before releasing a vehicle.
  type PaymentMethodType = NonNullable<Stripe.Checkout.SessionCreateParams["payment_method_types"]>[number];
  const paymentMethodTypes: PaymentMethodType[] = ["card", "link"];
  if (achEnabled) paymentMethodTypes.push("us_bank_account");

  // Single-charge enforcement: if we've already created a Checkout Session
  // for this invoice and it's still open with the same amount, hand the
  // customer back to it instead of opening a second pay window. This is the
  // primary defense against duplicate customer charges (e.g. customer
  // double-clicks "Pay" or refreshes the public pay page).
  let priorSessionState: "open" | "stale" | "none" = "none";
  if (invoice.stripeSessionId) {
    try {
      const existing = await stripe.checkout.sessions.retrieve(invoice.stripeSessionId);
      if (
        existing.status === "open" &&
        existing.url &&
        (existing.amount_total ?? 0) === amountCents
      ) {
        return { sessionId: existing.id, url: existing.url };
      }
      // Prior session is no longer the right one (expired/complete/amount
      // changed). If it's still open in Stripe, expire it now so a customer
      // who already had it open in another tab cannot complete a stale
      // charge. Then fall through and create a fresh session.
      if (existing.status === "open") {
        try { await stripe.checkout.sessions.expire(existing.id); } catch { /* best effort */ }
      }
      priorSessionState = "stale";
    } catch {
      // Retrieval failed (deleted/wrong account): fall through.
      priorSessionState = "stale";
    }
  }

  // Stripe-side idempotency: keying on invoice id + amount means a second
  // create call within the same balance state returns the already-created
  // session instead of minting a new one. Combined with the open-session
  // reuse above, this closes the race window for two near-simultaneous
  // "Pay" clicks. When the prior session is no longer usable (expired/
  // completed/amount-changed) we mix in a fresh nonce so we don't get a
  // stale Stripe response from inside Stripe's 24h idempotency window.
  const nonce = priorSessionState === "stale" ? `:${Date.now()}` : "";
  const idempotencyKey = `shopos:invoice:${invoiceId}:${amountCents}${nonce}`;
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: paymentMethodTypes,
    customer_email: customer?.email ?? undefined,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: amountCents,
        product_data: {
          name: `Invoice ${invoice.invoiceNumber}`,
          description: customer ? `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim() : undefined,
        },
      },
    }],
    success_url: `${baseUrl}/pay/${token}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/pay/${token}/cancelled`,
    metadata: {
      invoiceId: String(invoiceId),
      invoiceNumber: invoice.invoiceNumber,
    },
    payment_intent_data: {
      metadata: {
        invoiceId: String(invoiceId),
        invoiceNumber: invoice.invoiceNumber,
      },
    },
  }, { idempotencyKey });

  await db.update(invoicesTable).set({
    stripeSessionId: session.id,
    updatedAt: new Date(),
  }).where(eq(invoicesTable.id, invoiceId));

  return { sessionId: session.id, url: session.url };
}

router.post("/:id/checkout-session", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "")
      || (req.headers["x-forwarded-host"] && `${req.protocol}://${req.headers["x-forwarded-host"]}`)
      || `${req.protocol}://${req.get("host")}`;
    const out = await createCheckoutSessionForInvoice(id, base);
    res.json(out);
  } catch (err: any) {
    const status = err.status ?? 500;
    req.log?.error({ err: err.message, id }, "Checkout session create failed");
    res.status(status).json({ error: err.message ?? "Failed to create checkout session" });
  }
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    await db.transaction(async (tx) => {
      await reverseInvoiceConsumption(id, tx);
      await tx.delete(lineItemsTable).where(eq(lineItemsTable.invoiceId, id));
      await tx.delete(paymentsTable).where(eq(paymentsTable.invoiceId, id));
      await tx.delete(invoicesTable).where(eq(invoicesTable.id, id));
    });
  } catch (err) {
    req.log?.error({ err, id }, "Invoice delete transaction failed");
    return res.status(500).json({ error: "Failed to delete invoice" });
  }
  res.status(204).send();
});

export default router;
