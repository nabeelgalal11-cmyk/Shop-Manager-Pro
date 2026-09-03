import { and, eq, inArray } from "drizzle-orm";
import { invoicesTable, paymentsTable, squareRefundsTable, squareTerminalCheckoutsTable } from "@workspace/db";

/** Reconciles from durable rows, never from a webhook's potentially duplicate payload. */
export async function reconcileSquarePayment(tx: any, payment: any): Promise<void> {
  const [existing] = await tx.select().from(paymentsTable)
    .where(eq(paymentsTable.squarePaymentId, payment.id)).for("update");
  let local = existing;
  if (!local) {
    const [checkout] = await tx.select().from(squareTerminalCheckoutsTable)
      .where(eq(squareTerminalCheckoutsTable.squarePaymentId, payment.id));
    if (!checkout) return; // Payment did not originate in this application.
    [local] = await tx.insert(paymentsTable).values({
      invoiceId: checkout.invoiceId, amount: "0", method: "square_terminal", status: "pending",
      referenceNumber: payment.id, squarePaymentId: payment.id, paidAt: new Date(),
    }).returning();
  }
  if (payment.status === "COMPLETED" && local.status !== "succeeded") {
    await tx.update(paymentsTable).set({
      status: "succeeded", amount: ((payment.amount_money?.amount ?? 0) / 100).toFixed(2),
      failureReason: null,
    }).where(eq(paymentsTable.id, local.id));
  } else if (payment.status !== "COMPLETED" && payment.status !== "PENDING") {
    await tx.update(paymentsTable).set({ status: "failed", failureReason: `Square payment status: ${payment.status}` })
      .where(eq(paymentsTable.id, local.id));
  }
  await reconcileInvoiceAccounting(tx, local.invoiceId);
}

export async function reconcileInvoiceAccounting(tx: any, invoiceId: number): Promise<void> {
  const [invoice] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId)).for("update");
  if (!invoice) return;
  const payments = await tx.select().from(paymentsTable)
    .where(and(eq(paymentsTable.invoiceId, invoiceId), eq(paymentsTable.status, "succeeded")));
  const successful = payments.reduce((total: number, payment: any) => total + Number(payment.amount), 0);
  const ids = payments.map((payment: any) => payment.id);
  const refunds = ids.length
    ? await tx.select().from(squareRefundsTable).where(and(eq(squareRefundsTable.status, "COMPLETED"), inArray(squareRefundsTable.paymentId, ids)))
    : [];
  const refunded = refunds
    .reduce((total: number, refund: any) => total + Number(refund.amount), 0);
  const amountPaid = Math.max(0, successful - refunded);
  const balance = Math.max(0, Number(invoice.total) - amountPaid);
  await tx.update(invoicesTable).set({
    amountPaid: amountPaid.toFixed(2), balance: balance.toFixed(2),
    status: balance === 0 ? "paid" : (invoice.status === "paid" ? "sent" : invoice.status),
    updatedAt: new Date(),
  }).where(eq(invoicesTable.id, invoiceId));
}