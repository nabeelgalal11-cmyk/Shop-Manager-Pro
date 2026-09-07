import { type Request, type Response } from "express";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db, processorWebhookReceiptsTable } from "@workspace/db";
import { getStripeClient, getStripeSettings } from "../lib/stripe.js";
import { reconcileProcessorPayment } from "../lib/repair-workflow.js";

const invoiceIdFrom = (object: { metadata?: Stripe.Metadata | null }) => {
  const value = Number(object.metadata?.invoiceId);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
};
const intentId = (value: string | Stripe.PaymentIntent | null) => typeof value === "string" ? value : value?.id ?? null;

// Registered with express.raw(); signature verification must always use that exact Buffer.
export async function stripeWebhookHandler(req: Request, res: Response): Promise<void> {
  const signature = req.headers["stripe-signature"];
  if (typeof signature !== "string") { res.status(400).send("Missing stripe-signature header"); return; }
  let event: Stripe.Event;
  try {
    const stripe = await getStripeClient(), secret = (await getStripeSettings()).webhookSecret;
    if (!secret) { res.status(503).send("Webhook signing secret not configured"); return; }
    event = stripe.webhooks.constructEvent(req.body as Buffer, signature, secret);
  } catch (err) {
    req.log?.warn({ err }, "Stripe webhook signature verification failed");
    res.status(400).send("Webhook signature verification failed"); return;
  }
  const [receipt] = await db.insert(processorWebhookReceiptsTable).values({
    processor: "stripe", eventId: event.id, eventType: event.type, payload: event as unknown as Record<string, unknown>,
  }).onConflictDoNothing().returning();
  if (!receipt) { res.json({ received: true, idempotent: true }); return; }
  try {
    const object = event.data.object as Stripe.PaymentIntent | Stripe.Checkout.Session;
    const invoiceId = invoiceIdFrom(object);
    if (invoiceId && event.type === "checkout.session.completed") {
      const session = object as Stripe.Checkout.Session;
      if (session.payment_status === "paid") {
        const processorPaymentId = intentId(session.payment_intent) ?? session.id;
        await reconcileProcessorPayment({ invoiceId, amount: ((session.amount_total ?? 0) / 100).toFixed(2), processor: "stripe", processorPaymentId, processorEventId: event.id, method: "stripe", status: "succeeded" });
      }
    } else if (invoiceId && event.type === "payment_intent.succeeded") {
      const intent = object as Stripe.PaymentIntent;
      await reconcileProcessorPayment({ invoiceId, amount: ((intent.amount_received || intent.amount) / 100).toFixed(2), processor: "stripe", processorPaymentId: intent.id, processorEventId: event.id, method: "stripe", status: "succeeded" });
    } else if (invoiceId && (event.type === "payment_intent.payment_failed" || event.type === "checkout.session.expired")) {
      const intent = object as Stripe.PaymentIntent;
      const processorPaymentId = event.type === "payment_intent.payment_failed" ? intent.id : (intentId((object as Stripe.Checkout.Session).payment_intent) ?? (object as Stripe.Checkout.Session).id);
      const amount = event.type === "payment_intent.payment_failed" ? intent.amount : (object as Stripe.Checkout.Session).amount_total ?? 0;
      await reconcileProcessorPayment({ invoiceId, amount: (amount / 100).toFixed(2), processor: "stripe", processorPaymentId, processorEventId: event.id, method: "stripe", status: "failed", failureReason: event.type === "payment_intent.payment_failed" ? intent.last_payment_error?.message ?? "Stripe payment failed" : "Stripe checkout session expired" });
    }
    await db.update(processorWebhookReceiptsTable).set({ processedAt: new Date() }).where(eq(processorWebhookReceiptsTable.id, receipt.id));
    res.json({ received: true });
  } catch (err) {
    await db.update(processorWebhookReceiptsTable).set({ failureReason: err instanceof Error ? err.message : "Webhook processing failed" }).where(eq(processorWebhookReceiptsTable.id, receipt.id));
    req.log?.error({ err, event: event.id }, "Stripe webhook processing failed");
    res.status(500).send("Webhook handler error");
  }
}