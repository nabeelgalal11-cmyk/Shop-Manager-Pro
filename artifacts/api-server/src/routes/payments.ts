import { Router } from "express";
import { db } from "@workspace/db";
import { paymentsTable, invoicesTable, customersTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
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

  const payments = await (invoiceId
    ? db.select().from(paymentsTable).where(eq(paymentsTable.invoiceId, invoiceId)).orderBy(desc(paymentsTable.paidAt)).limit(limit).offset(offset)
    : db.select().from(paymentsTable).orderBy(desc(paymentsTable.paidAt)).limit(limit).offset(offset));
  const [countResult] = await db.select({ count: sql<number>`count(*)` }).from(paymentsTable);
  res.json({ data: payments, total: Number(countResult.count), page, limit });
});

router.post("/", async (req, res) => {
  const { invoiceId, amount, method, referenceNumber, notes, paidAt } = req.body;
  const [payment] = await db.insert(paymentsTable).values({
    invoiceId, amount: amount.toString(), method, referenceNumber, notes,
    paidAt: paidAt ? new Date(paidAt) : new Date(),
  }).returning();

  const allPayments = await db.select().from(paymentsTable).where(eq(paymentsTable.invoiceId, invoiceId));
  const amountPaid = allPayments.reduce((sum, p) => sum + Number(p.amount), 0);
  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
  const balance = Number(invoice.total) - amountPaid;
  await db.update(invoicesTable).set({
    amountPaid: amountPaid.toString(),
    balance: balance.toString(),
    status: balance <= 0 ? "paid" : "sent",
    updatedAt: new Date(),
  }).where(eq(invoicesTable.id, invoiceId));

  await recordActivity({
    entityType: "invoice",
    entityId: invoiceId,
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
  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, Number(req.params.id)));
  if (payment) {
    await db.delete(paymentsTable).where(eq(paymentsTable.id, payment.id));
    const remaining = await db.select().from(paymentsTable).where(eq(paymentsTable.invoiceId, payment.invoiceId));
    const amountPaid = remaining.reduce((sum, p) => sum + Number(p.amount), 0);
    const [invoice] = await db.select({ total: invoicesTable.total }).from(invoicesTable).where(eq(invoicesTable.id, payment.invoiceId));
    const balance = Number(invoice.total) - amountPaid;
    await db.update(invoicesTable).set({ amountPaid: amountPaid.toString(), balance: balance.toString(), status: balance <= 0 ? "paid" : "sent", updatedAt: new Date() }).where(eq(invoicesTable.id, payment.invoiceId));
  }
  res.status(204).send();
});

export default router;
