import { type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, paymentsTable, squareRefundsTable, squareTerminalCheckoutsTable, squareWebhookEventsTable } from "@workspace/db";
import { ReceiveSquareWebhookBody } from "@workspace/api-zod";
import { centsToDollars, SquareClient, verifySquareWebhookSignature } from "../lib/square.js";
import { reconcileInvoiceAccounting, reconcileSquarePayment } from "../lib/square-accounting.js";

function notificationUrl(req: Request): string {
  // This must exactly match the URL configured in Square's webhook subscription.
  return process.env.SQUARE_WEBHOOK_NOTIFICATION_URL
    ?? `${req.protocol}://${req.get("host")}/api/square/webhook`;
}

export async function squareWebhookHandler(req: Request, res: Response): Promise<void> {
  if (!process.env.SQUARE_WEBHOOK_SIGNATURE_KEY) {
    res.status(503).json({ error: "Square webhook signing key is not configured" });
    return;
  }
  const raw = req.body as Buffer;
  const signature = req.header("x-square-hmacsha256-signature") ?? undefined;
  try {
    if (!verifySquareWebhookSignature(raw, signature, notificationUrl(req))) {
      req.log?.warn("Square webhook signature verification failed");
      res.status(403).json({ error: "Invalid Square webhook signature" });
      return;
    }
    const event = JSON.parse(raw.toString("utf8"));
    const parsed = ReceiveSquareWebhookBody.safeParse(event);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const inserted = await db.insert(squareWebhookEventsTable).values({ squareEventId: event.event_id, eventType: event.type, payload: event }).onConflictDoNothing().returning({ id: squareWebhookEventsTable.id });
    if (!inserted.length) { res.json({ received: true, idempotent: true }); return; }
    const object = event.data?.object;
    const payment = object?.payment;
    const refund = object?.refund;
    const checkout = object?.checkout;
    const checkoutPaymentId = checkout?.payment_ids?.[0] ?? null;
    const checkoutPayment = checkoutPaymentId ? (await new SquareClient().getPayment(checkoutPaymentId)).payment : null;
    if (payment?.id) {
      await db.transaction((tx) => reconcileSquarePayment(tx, payment));
    }
    if (refund?.id) {
      await db.transaction(async (tx) => {
        const [local] = await tx.select().from(squareRefundsTable).where(eq(squareRefundsTable.squareRefundId, refund.id)).for("update");
        if (!local) return; // Ignore refunds for payments not created by this app.
        await tx.update(squareRefundsTable).set({ status: refund.status, updatedAt: new Date() }).where(eq(squareRefundsTable.id, local.id));
        if (refund.status === "COMPLETED") {
          const [paymentRow] = await tx.select().from(paymentsTable).where(eq(paymentsTable.id, local.paymentId));
          if (paymentRow) await reconcileInvoiceAccounting(tx, paymentRow.invoiceId);
        }
      });
    }
    if (checkout?.id) {
      await db.transaction(async (tx) => {
        const [local] = await tx.update(squareTerminalCheckoutsTable).set({ status: checkout.status, squarePaymentId: checkoutPaymentId, updatedAt: new Date() }).where(eq(squareTerminalCheckoutsTable.squareCheckoutId, checkout.id)).returning();
        if (local && checkoutPayment) await reconcileSquarePayment(tx, checkoutPayment);
      });
    }
    await db.update(squareWebhookEventsTable).set({ processedAt: new Date() }).where(eq(squareWebhookEventsTable.id, inserted[0].id));
    res.json({ received: true });
  } catch (err) {
    req.log?.error({ err }, "Square webhook processing failed");
    res.status(500).json({ error: "Square webhook processing failed" });
  }
}