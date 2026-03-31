import { Router } from "express";
import { db } from "@workspace/db";
import { paymentsTable, invoicesTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";

const router = Router();

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
  const [invoice] = await db.select({ total: invoicesTable.total }).from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
  const balance = Number(invoice.total) - amountPaid;
  await db.update(invoicesTable).set({
    amountPaid: amountPaid.toString(),
    balance: balance.toString(),
    status: balance <= 0 ? "paid" : "sent",
    updatedAt: new Date(),
  }).where(eq(invoicesTable.id, invoiceId));

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
