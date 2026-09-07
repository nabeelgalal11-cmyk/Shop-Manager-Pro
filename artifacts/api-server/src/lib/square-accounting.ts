import { reconcileProcessorPayment } from "./repair-workflow.js";

/** Convert Square's verified Payments API representation into a ledger entry. */
export async function reconcileSquarePayment(payment: any, invoiceId: number, eventId: string) {
  const amount = payment?.amount_money?.amount;
  if (!payment?.id || !Number.isSafeInteger(amount) || amount <= 0) throw new Error("Square payment is missing a valid amount");
  const status = payment.status === "COMPLETED" ? "succeeded" : payment.status === "PENDING" ? "pending" : "failed";
  return reconcileProcessorPayment({
    invoiceId, amount: (amount / 100).toFixed(2), processor: "square", processorPaymentId: payment.id,
    processorEventId: eventId, method: "square", status,
    failureReason: status === "failed" ? `Square payment status: ${payment.status}` : null,
  });
}