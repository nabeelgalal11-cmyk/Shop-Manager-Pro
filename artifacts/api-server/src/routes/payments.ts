import { Router } from "express";
import { db } from "@workspace/db";
import { paymentsTable, invoicesTable, customersTable } from "@workspace/db";
import { and, eq, sql, desc } from "drizzle-orm";
import { sendTemplatedEmail } from "../lib/email.js";
import { recordActivity } from "../lib/activity.js";

const router: Router = Router();

async function maybeSendPaymentReceipt(payment: any, invoice: any, balance: number, req: any) {
  try {
    const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, invoice.customerId));
    if (!customer?.email) {
      req.log?.info({ id: payment.id }, "No customer email; skipping payment receipt");
      return;
    }
    const result = await sendTemplatedEmail("payment_received", customer.email, {
      customerName: `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim() || "Customer",
      customerEmail: customer.email,
      shopName: process.env.SHOP_NAME || "Our Shop",
      invoiceNumber: invoice.invoiceNumber,
      amount: `$${Number(payment.amount).toFixed(2)}`,
      method: payment.method || "—",
      referenceNumber: payment.referenceNumber || "—",
      balance: `$${Math.max(0, balance).toFixed(2)}`,
      paidAt: payment.paidAt ? new Date(payment.paidAt).toLocaleString() : new Date().toLocaleString(),
    });
    if (!result.ok) req.log?.warn({ err: result.error, id: payment.id }, "Payment receipt email failed");
    else {
      await recordActivity({
        entityType: "invoice",
        entityId: invoice.id,
        eventType: "email_sent",
        meta: { template: "payment_received", paymentId: payment.id, to: customer.email },
        customerId: invoice.customerId ?? null,
        req,
      });
    }
  } catch (err) {
    req.log?.error({ err }, "maybeSendPaymentReceipt crashed");
  }
}

router.get("/", async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const invoiceId = req.query.invoiceId ? Number(req.query.invoiceId) : undefined;
  const offset = (page - 1) * limit;

  const payments = await (invoiceId !== undefined
    ? db.select().from(paymentsTable).where(eq(paymentsTable.invoiceId, invoiceId)).orderBy(desc(paymentsTable.paidAt)).limit(limit).offset(offset)
    : db.select().from(paymentsTable).orderBy(desc(paymentsTable.paidAt)).limit(limit).offset(offset));
  const [countResult] = await (invoiceId !== undefined
    ? db.select({ count: sql<number>`count(*)` }).from(paymentsTable).where(eq(paymentsTable.invoiceId, invoiceId))
    : db.select({ count: sql<number>`count(*)` }).from(paymentsTable));
  res.json({ data: payments, total: Number(countResult.count), page, limit });
});

router.post("/", async (req, res) => {
  const { invoiceId, amount, method, referenceNumber, notes, paidAt } = req.body;
  const numericInvoiceId = Number(invoiceId);
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ error: "Payment amount must be a finite number greater than zero" });
  }

  type Result =
    | { kind: "ok"; payment: any; invoice: any; balance: number }
    | { kind: "error"; status: number; error: string };

  const result = await db.transaction(async (tx): Promise<Result> => {
    const [invoice] = Number.isFinite(numericInvoiceId)
      ? await tx.select().from(invoicesTable)
        .where(eq(invoicesTable.id, numericInvoiceId)).for("update")
      : [];
    if (!invoice) return { kind: "error", status: 404, error: "Invoice not found" };

    const successfulPayments = await tx.select().from(paymentsTable).where(and(
      eq(paymentsTable.invoiceId, numericInvoiceId),
      eq(paymentsTable.status, "succeeded"),
    ));
    const previousAmountPaid = successfulPayments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    const currentBalance = Math.max(0, Number(invoice.total) - previousAmountPaid);
    if (numericAmount > currentBalance) {
      return { kind: "error", status: 400, error: "Payment amount exceeds the invoice balance" };
    }

    const [payment] = await tx.insert(paymentsTable).values({
      invoiceId: numericInvoiceId, amount: numericAmount.toString(), method, referenceNumber, notes,
      paidAt: paidAt ? new Date(paidAt) : new Date(),
      status: "succeeded",
    }).returning();
    const amountPaid = previousAmountPaid + numericAmount;
    const balance = Math.max(0, Number(invoice.total) - amountPaid);
    await tx.update(invoicesTable).set({
      amountPaid: amountPaid.toString(),
      balance: balance.toString(),
      status: invoice.status === "void" ? "void" : balance <= 0 ? "paid" : "sent",
      updatedAt: new Date(),
    }).where(eq(invoicesTable.id, numericInvoiceId));

    return { kind: "ok", payment, invoice, balance };
  });

  if (result.kind === "error") {
    return res.status(result.status).json({ error: result.error });
  }
  const { payment, invoice, balance } = result;

  await recordActivity({
    entityType: "invoice",
    entityId: numericInvoiceId,
    eventType: "payment_received",
    meta: {
      paymentId: payment.id,
      amount: Number(payment.amount),
      method: payment.method,
      referenceNumber: payment.referenceNumber ?? null,
      remainingBalance: Math.max(0, balance),
    },
    customerId: invoice?.customerId ?? null,
    req,
  });

  await maybeSendPaymentReceipt(payment, invoice, balance, req);

  res.status(201).json(payment);
});

router.get("/:id", async (req, res) => {
  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, Number(req.params.id)));
  if (!payment) return res.status(404).json({ error: "Payment not found" });
  res.json(payment);
});

router.delete("/:id", async (req, res) => {
  const result = await db.transaction(async (tx) => {
    const [existingPayment] = await tx.select().from(paymentsTable).where(eq(paymentsTable.id, Number(req.params.id)));
    if (!existingPayment) return null;

    const [invoice] = await tx.select().from(invoicesTable)
      .where(eq(invoicesTable.id, existingPayment.invoiceId)).for("update");
    if (!invoice) return null;

    const [payment] = await tx.delete(paymentsTable)
      .where(eq(paymentsTable.id, existingPayment.id)).returning();
    if (!payment) return null;

    const remaining = await tx.select().from(paymentsTable).where(and(
      eq(paymentsTable.invoiceId, payment.invoiceId),
      eq(paymentsTable.status, "succeeded"),
    ));
    const amountPaid = remaining.reduce((sum, remainingPayment) => sum + Number(remainingPayment.amount), 0);
    const balance = Math.max(0, Number(invoice.total) - amountPaid);
    await tx.update(invoicesTable).set({
      amountPaid: amountPaid.toString(),
      balance: balance.toString(),
      status: invoice.status === "void" ? "void" : balance <= 0 ? "paid" : "sent",
      updatedAt: new Date(),
    }).where(eq(invoicesTable.id, payment.invoiceId));

    return { payment, invoice, balance };
  });

  if (result) {
    const { payment, invoice, balance } = result;
    await recordActivity({
      entityType: "invoice",
      entityId: payment.invoiceId,
      eventType: "deleted",
      meta: {
        target: "payment",
        paymentId: payment.id,
        amount: Number(payment.amount),
        method: payment.method,
        remainingBalance: Math.max(0, balance),
      },
      customerId: invoice?.customerId ?? null,
      req,
    });
  }
  res.status(204).send();
});

export default router;
