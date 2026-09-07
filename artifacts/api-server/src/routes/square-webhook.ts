import { type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, paymentsTable, processorWebhookReceiptsTable } from "@workspace/db";
import { ReceiveSquareWebhookBody } from "@workspace/api-zod";
import { SquareClient, verifySquareWebhookSignature } from "../lib/square.js";
import { reconcileSquarePayment } from "../lib/square-accounting.js";
import { reconcileProcessorRefund } from "../lib/repair-workflow.js";

function notificationUrl(req: Request): string {
  return process.env.SQUARE_WEBHOOK_NOTIFICATION_URL ?? `${req.protocol}://${req.get("host")}/api/square/webhook`;
}

export async function squareWebhookHandler(req: Request, res: Response): Promise<void> {
  if (!process.env.SQUARE_WEBHOOK_SIGNATURE_KEY) { res.status(503).json({ error: "Square webhook signing key is not configured" }); return; }
  const raw = req.body as Buffer;
  try {
    if (!verifySquareWebhookSignature(raw, req.header("x-square-hmacsha256-signature") ?? undefined, notificationUrl(req))) {
      res.status(403).json({ error: "Invalid Square webhook signature" }); return;
    }
    const event = ReceiveSquareWebhookBody.parse(JSON.parse(raw.toString("utf8")));
    const [receipt] = await db.insert(processorWebhookReceiptsTable).values({
      processor: "square", eventId: event.event_id, eventType: event.type, payload: event as Record<string, unknown>,
    }).onConflictDoNothing().returning();
    if (!receipt) { res.json({ received: true, idempotent: true }); return; }
    try {
      const object: any = (event as any).data?.object;
      if (object?.payment?.id) {
        const payment = object.payment;
        const [local] = await db.select({ invoiceId: paymentsTable.invoiceId }).from(paymentsTable).where(and(eq(paymentsTable.processor, "square"), eq(paymentsTable.processorPaymentId, payment.id)));
        if (local) await reconcileSquarePayment(payment, local.invoiceId, event.event_id);
      }
      if (object?.refund?.id && object.refund.status === "COMPLETED") {
        const refund = object.refund;
        await reconcileProcessorRefund({ processor: "square", processorPaymentId: refund.payment_id, refundId: refund.id, eventId: event.event_id, amount: (refund.amount_money.amount / 100).toFixed(2), reason: refund.reason });
      }
      await db.update(processorWebhookReceiptsTable).set({ processedAt: new Date() }).where(eq(processorWebhookReceiptsTable.id, receipt.id));
      res.json({ received: true });
    } catch (err) {
      await db.update(processorWebhookReceiptsTable).set({ failureReason: err instanceof Error ? err.message : "Webhook processing failed" }).where(eq(processorWebhookReceiptsTable.id, receipt.id));
      throw err;
    }
  } catch (err) {
    req.log?.error({ err }, "Square webhook processing failed");
    res.status(500).json({ error: "Square webhook processing failed" });
  }
}