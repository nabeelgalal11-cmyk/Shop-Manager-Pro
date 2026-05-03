import { type Request, type Response } from "express";
import Stripe from "stripe";
import { db, invoicesTable, paymentsTable, lineItemsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { getStripeClient, getStripeSettings } from "../lib/stripe.js";
import { applyStockMovement, getInventoryUnitCost } from "../lib/inventory.js";
import type { DbExecutor } from "../lib/inventory.js";
import { recordActivity } from "../lib/activity.js";

async function applyConsumptionIfNeeded(invoiceId: number, executor: DbExecutor = db) {
  // Mirrors logic in routes/invoices.ts. Idempotent at the caller level via stripe_event_id.
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

// Express raw-body handler: req.body is a Buffer here.
export async function stripeWebhookHandler(req: Request, res: Response) {
  const sig = req.headers["stripe-signature"] as string | undefined;
  if (!sig) return res.status(400).send("Missing stripe-signature header");

  let stripe: Stripe;
  let webhookSecret: string | null;
  try {
    stripe = await getStripeClient();
    webhookSecret = (await getStripeSettings()).webhookSecret;
  } catch (err: any) {
    req.log?.warn({ err: err.message }, "Stripe webhook received but Stripe not configured");
    return res.status(503).send("Stripe not configured");
  }
  if (!webhookSecret) return res.status(503).send("Webhook signing secret not configured");

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body as Buffer, sig, webhookSecret);
  } catch (err: any) {
    req.log?.warn({ err: err.message }, "Stripe webhook signature verification failed");
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Shared success-recording path used by both checkout.session.completed and
  // payment_intent.succeeded. Either event may arrive first depending on the
  // shop's Stripe webhook subscription; both call this function and the second
  // one is a no-op thanks to the unique stripe_event_id index plus the
  // duplicate payment_intent guard inside the transaction.
  async function recordSuccessfulPayment(opts: {
    invoiceId: number;
    amountCents: number;
    paymentIntentId: string | null;
    referenceNumber: string;
    eventId: string;
    note: string;
  }): Promise<{ status: "recorded_success" | "duplicate" | "already_paid" | "overpayment_rejected"; rejectionReason?: string }> {
    const { invoiceId, amountCents, paymentIntentId, referenceNumber, eventId, note } = opts;
    let outcome: { status: "recorded_success" | "duplicate" | "already_paid" | "overpayment_rejected"; rejectionReason?: string } = { status: "recorded_success" };
    try {
      await db.transaction(async (tx) => {
      // Lock the invoice row for the duration of the transaction so two
      // concurrent webhook deliveries (e.g. customer opened two tabs and
      // both Checkout Sessions completed) cannot both insert a succeeded
      // payment for the same invoice.
      const [invoice] = await tx.select().from(invoicesTable)
        .where(eq(invoicesTable.id, invoiceId)).for("update");
      if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);

      // Overpayment guard: if the invoice is already fully paid (either by
      // an earlier Stripe success or by a manually-recorded payment), refuse
      // to record this additional success. Returning here marks the event as
      // processed (via stripe_event_id) so Stripe stops retrying. The
      // duplicate charge sits in Stripe and can be refunded manually.
      const currentBalance = Number(invoice.balance);
      if (invoice.status === "paid" || currentBalance <= 0) {
        outcome = { status: "already_paid" };
        return;
      }

      // Overpayment guard: refuse to record a Stripe success whose amount
      // exceeds the current outstanding balance (e.g. invoice was edited
      // downward after session creation, or a stale session for a higher
      // amount completes). Persisting a 'failed' row preserves the audit
      // trail and ensures the event is marked processed (event_id is
      // unique) so Stripe stops retrying.
      const incomingDollars = amountCents / 100;
      if (incomingDollars - currentBalance > 0.005) {
        const reason = `Stripe charge ${incomingDollars.toFixed(2)} exceeds outstanding balance ${currentBalance.toFixed(2)} — refund manually`;
        await tx.insert(paymentsTable).values({
          invoiceId,
          amount: "0",
          method: "stripe",
          status: "failed",
          failureReason: reason,
          referenceNumber,
          stripeEventId: eventId,
          stripePaymentIntentId: paymentIntentId,
          notes: "Overpayment rejected (likely stale session after invoice edit)",
          paidAt: new Date(),
        });
        outcome = { status: "overpayment_rejected", rejectionReason: reason };
        return;
      }

      // Guard: if we already recorded a succeeded payment for this payment_intent
      // (e.g. via the sibling event), skip. Both checkout.session.completed and
      // payment_intent.succeeded carry the same payment_intent id.
      if (paymentIntentId) {
        const dup = await tx.select().from(paymentsTable).where(and(
          eq(paymentsTable.stripePaymentIntentId, paymentIntentId),
          eq(paymentsTable.status, "succeeded"),
        ));
        if (dup.length > 0) {
          outcome = { status: "duplicate" };
          return;
        }
      }

      await tx.insert(paymentsTable).values({
        invoiceId,
        amount: (amountCents / 100).toString(),
        method: "stripe",
        status: "succeeded",
        referenceNumber,
        stripeEventId: eventId,
        stripePaymentIntentId: paymentIntentId,
        notes: note,
        paidAt: new Date(),
      });

      const allPayments = await tx.select().from(paymentsTable).where(and(
        eq(paymentsTable.invoiceId, invoiceId),
        eq(paymentsTable.status, "succeeded"),
      ));
      const amountPaid = allPayments.reduce((s, p) => s + Number(p.amount), 0);
      const balance = Number(invoice.total) - amountPaid;
      const wasUnpaid = invoice.status !== "paid";
      const wasConsumed = invoice.status === "sent" || invoice.status === "paid";
      const newStatus = balance <= 0 ? "paid" : invoice.status;

      await tx.update(invoicesTable).set({
        amountPaid: amountPaid.toString(),
        balance: balance.toString(),
        status: newStatus,
        stripePaymentIntentId: paymentIntentId,
        updatedAt: new Date(),
      }).where(eq(invoicesTable.id, invoiceId));

      if (wasUnpaid && newStatus === "paid" && !wasConsumed) {
        await applyConsumptionIfNeeded(invoiceId, tx);
      }
      });
      return outcome;
    } catch (err: any) {
      // Concurrency safety net: the partial unique index on
      // (stripe_payment_intent_id) WHERE status='succeeded' rejects a second
      // succeeded row when two webhook deliveries race past the in-tx check.
      const code = err?.cause?.code ?? err?.code;
      if (code === "23505") return { status: "duplicate" };
      throw err;
    }
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const invoiceIdStr = session.metadata?.invoiceId;
      const invoiceId = invoiceIdStr ? Number(invoiceIdStr) : NaN;
      if (!Number.isFinite(invoiceId)) {
        req.log?.warn({ session: session.id }, "checkout.session.completed missing invoiceId metadata");
        return res.json({ received: true });
      }
      if (session.payment_status !== "paid") {
        return res.json({ received: true, skipped: "not paid" });
      }

      // Idempotency: keyed on event.id (unique index)
      const existing = await db.select().from(paymentsTable).where(eq(paymentsTable.stripeEventId, event.id));
      if (existing.length > 0) {
        return res.json({ received: true, idempotent: true });
      }

      const paymentIntentId = typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id ?? null;

      const checkoutResult = await recordSuccessfulPayment({
        invoiceId,
        amountCents: session.amount_total ?? 0,
        paymentIntentId,
        referenceNumber: session.id,
        eventId: event.id,
        note: "Online payment via Stripe Checkout",
      });

      if (checkoutResult.status === "recorded_success") {
        const [inv] = await db.select({ customerId: invoicesTable.customerId }).from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
        await recordActivity({
          entityType: "invoice",
          entityId: invoiceId,
          eventType: "payment_received",
          meta: { source: "stripe_checkout", amount: (session.amount_total ?? 0) / 100, sessionId: session.id, paymentIntentId },
          actorId: null,
          actorLabel: "stripe",
          customerId: inv?.customerId ?? null,
        });
      } else if (checkoutResult.status === "overpayment_rejected") {
        const [inv] = await db.select({ customerId: invoicesTable.customerId }).from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
        await recordActivity({
          entityType: "invoice",
          entityId: invoiceId,
          eventType: "payment_failed",
          meta: { source: "stripe_checkout", reason: checkoutResult.rejectionReason, sessionId: session.id, paymentIntentId },
          actorId: null,
          actorLabel: "stripe",
          customerId: inv?.customerId ?? null,
        });
      }
      req.log?.info({ invoiceId, event: event.id }, "Stripe checkout completed (recorded)");
      return res.json({ received: true });
    }

    if (event.type === "payment_intent.succeeded") {
      const intent = event.data.object as Stripe.PaymentIntent;
      const invoiceIdStr = intent.metadata?.invoiceId;
      const invoiceId = invoiceIdStr ? Number(invoiceIdStr) : NaN;
      if (!Number.isFinite(invoiceId)) {
        // No invoice metadata means this payment_intent didn't originate from
        // ShopOS — silently ignore.
        return res.json({ received: true });
      }

      const existing = await db.select().from(paymentsTable).where(eq(paymentsTable.stripeEventId, event.id));
      if (existing.length > 0) {
        return res.json({ received: true, idempotent: true });
      }

      const intentResult = await recordSuccessfulPayment({
        invoiceId,
        amountCents: intent.amount_received ?? intent.amount ?? 0,
        paymentIntentId: intent.id,
        referenceNumber: intent.id,
        eventId: event.id,
        note: "Online payment via Stripe (payment_intent.succeeded)",
      });

      if (intentResult.status === "recorded_success") {
        const [inv] = await db.select({ customerId: invoicesTable.customerId }).from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
        await recordActivity({
          entityType: "invoice",
          entityId: invoiceId,
          eventType: "payment_received",
          meta: { source: "stripe_payment_intent", amount: (intent.amount_received ?? intent.amount ?? 0) / 100, paymentIntentId: intent.id },
          actorId: null,
          actorLabel: "stripe",
          customerId: inv?.customerId ?? null,
        });
      } else if (intentResult.status === "overpayment_rejected") {
        const [inv] = await db.select({ customerId: invoicesTable.customerId }).from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
        await recordActivity({
          entityType: "invoice",
          entityId: invoiceId,
          eventType: "payment_failed",
          meta: { source: "stripe_payment_intent", reason: intentResult.rejectionReason, paymentIntentId: intent.id },
          actorId: null,
          actorLabel: "stripe",
          customerId: inv?.customerId ?? null,
        });
      }
      req.log?.info({ invoiceId, event: event.id }, "Stripe payment_intent succeeded (recorded)");
      return res.json({ received: true });
    }

    if (event.type === "payment_intent.payment_failed" || event.type === "checkout.session.expired") {
      const obj = event.data.object as Stripe.PaymentIntent | Stripe.Checkout.Session;
      const invoiceIdStr = obj.metadata?.invoiceId;
      const invoiceId = invoiceIdStr ? Number(invoiceIdStr) : NaN;
      if (!Number.isFinite(invoiceId)) {
        req.log?.warn({ event: event.id, type: event.type }, "Stripe failure event missing invoiceId metadata");
        return res.json({ received: true });
      }

      // Idempotent: stripe_event_id is unique. Persist a zero-amount
      // status='failed' row so the invoice timeline shows the attempt
      // without affecting amount_paid.
      const existing = await db.select().from(paymentsTable).where(eq(paymentsTable.stripeEventId, event.id));
      if (existing.length > 0) {
        return res.json({ received: true, idempotent: true });
      }

      const isIntent = event.type === "payment_intent.payment_failed";
      const intent = isIntent ? (obj as Stripe.PaymentIntent) : null;
      const session = isIntent ? null : (obj as Stripe.Checkout.Session);
      const reason = isIntent
        ? intent?.last_payment_error?.message ?? "Payment failed"
        : "Checkout session expired";
      const paymentIntentId = isIntent
        ? intent?.id ?? null
        : (typeof session?.payment_intent === "string" ? session?.payment_intent : session?.payment_intent?.id ?? null);

      await db.insert(paymentsTable).values({
        invoiceId,
        amount: "0",
        method: "stripe",
        status: "failed",
        failureReason: reason,
        referenceNumber: isIntent ? intent?.id ?? null : session?.id ?? null,
        stripeEventId: event.id,
        stripePaymentIntentId: paymentIntentId,
        notes: isIntent ? "Stripe payment attempt failed" : "Stripe checkout session expired",
        paidAt: new Date(),
      });

      const [invForFail] = await db.select({ customerId: invoicesTable.customerId }).from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
      await recordActivity({
        entityType: "invoice",
        entityId: invoiceId,
        eventType: "payment_failed",
        meta: { reason, type: event.type, paymentIntentId },
        actorId: null,
        actorLabel: "stripe",
        customerId: invForFail?.customerId ?? null,
      });
      req.log?.warn({ invoiceId, event: event.id, reason }, "Stripe payment attempt failed (recorded)");
      // Invoice stays in `sent` — nothing to recompute.
      return res.json({ received: true });
    }

    return res.json({ received: true, ignored: event.type });
  } catch (err: any) {
    req.log?.error({ err, event: event.id }, "Stripe webhook handler crashed");
    return res.status(500).send("Webhook handler error");
  }
}
