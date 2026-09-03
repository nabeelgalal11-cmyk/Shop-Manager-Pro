import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, invoicesTable, paymentsTable, squareMappingsTable, squareRefundsTable, squareSyncStatesTable, squareTerminalCheckoutsTable } from "@workspace/db";
import { ApplySquareSyncBody, ApplySquareSyncParams, ApplySquareSyncResponse, CancelSquareTerminalCheckoutParams, CancelSquareTerminalCheckoutResponse, CreateSquareInvoicePaymentBody, CreateSquareInvoicePaymentParams, CreateSquareTerminalCheckoutBody, CreateSquareRefundBody, GetSquareStatusResponse, GetSquareTerminalCheckoutParams, GetSquareTerminalCheckoutResponse, PreviewSquareSyncParams, PreviewSquareSyncResponse } from "@workspace/api-zod";
import { requirePermission } from "../lib/auth.js";
import { SquareClient, SquareError, centsToDollars, dollarsToCents } from "../lib/square.js";
import { reconcileInvoiceAccounting, reconcileSquarePayment } from "../lib/square-accounting.js";

const router: IRouter = Router();
const fail = (res: any, err: unknown) => {
  const e = err instanceof SquareError ? err : new SquareError("Square operation failed", 502);
  res.status(e.status).json({ error: e.message, code: e.code });
};
const client = () => new SquareClient();
function parsed<T>(result: { success: boolean; data?: T; error?: { message: string } }, res: any): T | null {
  if (result.success) return result.data as T;
  res.status(400).json({ error: result.error?.message ?? "Invalid request" });
  return null;
}

router.get("/status", requirePermission("payments", "view"), async (_req, res): Promise<void> => {
  try {
    const locations = await client().locations();
    res.json(GetSquareStatusResponse.parse({ configured: true, environment: process.env.SQUARE_ENVIRONMENT ?? "sandbox", locations: locations.locations.map((l) => ({ id: l.id, name: l.name, status: l.status })) }));
  } catch (err) { fail(res, err); }
});

router.post("/invoices/:invoiceId/payment", requirePermission("payments", "create"), async (req, res): Promise<void> => {
  const params = parsed(CreateSquareInvoicePaymentParams.safeParse(req.params), res);
  const input = parsed(CreateSquareInvoicePaymentBody.safeParse(req.body), res);
  if (!params || !input) return;
  const invoiceId = params.invoiceId;
  const { sourceId, locationId } = input;
  try {
    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
    if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }
    if (Number(invoice.balance) <= 0) { res.status(409).json({ error: "Invoice has no outstanding balance" }); return; }
    const payment = (await client().createPayment({ sourceId, locationId, amountCents: dollarsToCents(invoice.balance), referenceId: `invoice:${invoice.id}` })).payment;
    await db.transaction(async (tx) => {
      await tx.insert(paymentsTable).values({ invoiceId, amount: "0", method: "square", status: "pending", referenceNumber: payment.id, squarePaymentId: payment.id, paidAt: new Date() }).onConflictDoNothing();
      await reconcileSquarePayment(tx, payment);
    });
    res.status(201).json({ paymentId: payment.id, status: payment.status });
  } catch (err) { req.log?.warn({ err }, "Square invoice payment failed"); fail(res, err); }
});

router.post("/terminal/checkouts", requirePermission("payments", "create"), async (req, res): Promise<void> => {
  const input = parsed(CreateSquareTerminalCheckoutBody.safeParse(req.body), res);
  if (!input) return;
  const { invoiceId, deviceId } = input;
  try {
    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
    if (!invoice || Number(invoice.balance) <= 0) { res.status(409).json({ error: "Invoice is unavailable for checkout" }); return; }
    const checkout = (await client().createTerminalCheckout({ deviceId, amountCents: dollarsToCents(invoice.balance), referenceId: `invoice:${invoice.id}` })).checkout;
    await db.insert(squareTerminalCheckoutsTable).values({ invoiceId: invoice.id, deviceId, squareCheckoutId: checkout.id, status: checkout.status, amount: invoice.balance });
    res.status(201).json({ id: checkout.id, status: checkout.status });
  } catch (err) { fail(res, err); }
});

router.get("/terminal/checkouts/:id", requirePermission("payments", "view"), async (req, res): Promise<void> => {
  const params = parsed(GetSquareTerminalCheckoutParams.safeParse(req.params), res);
  if (!params) return;
  const id = params.id;
  try {
    const checkout = (await client().getTerminalCheckout(id)).checkout;
    const paymentId = checkout.payment_ids?.[0] ?? null;
    const squarePayment = paymentId ? (await client().getPayment(paymentId)).payment : null;
    await db.transaction(async (tx) => {
      await tx.update(squareTerminalCheckoutsTable).set({ status: checkout.status, squarePaymentId: paymentId, updatedAt: new Date() }).where(eq(squareTerminalCheckoutsTable.squareCheckoutId, checkout.id));
      if (squarePayment) await reconcileSquarePayment(tx, squarePayment);
    });
    res.json(GetSquareTerminalCheckoutResponse.parse(checkout));
  } catch (err) { fail(res, err); }
});
router.post("/terminal/checkouts/:id/cancel", requirePermission("payments", "edit"), async (req, res): Promise<void> => {
  const params = parsed(CancelSquareTerminalCheckoutParams.safeParse(req.params), res);
  if (!params) return;
  const id = params.id;
  try { const checkout = (await client().cancelTerminalCheckout(id)).checkout; await db.update(squareTerminalCheckoutsTable).set({ status: checkout.status, updatedAt: new Date() }).where(eq(squareTerminalCheckoutsTable.squareCheckoutId, checkout.id)); res.json(CancelSquareTerminalCheckoutResponse.parse(checkout)); } catch (err) { fail(res, err); }
});

router.post("/refunds", requirePermission("payments", "edit"), async (req, res): Promise<void> => {
  const input = parsed(CreateSquareRefundBody.safeParse(req.body), res);
  if (!input) return;
  const { paymentId, amount, reason } = input;
  try {
    const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, paymentId));
    if (!payment?.squarePaymentId) { res.status(409).json({ error: "Payment is not a Square payment" }); return; }
    if (payment.status !== "succeeded") { res.status(409).json({ error: "Payment has not completed" }); return; }
    const existingRefunds = await db.select().from(squareRefundsTable).where(eq(squareRefundsTable.paymentId, payment.id));
    const alreadyRefunded = existingRefunds.filter((refund) => refund.status !== "FAILED" && refund.status !== "REJECTED")
      .reduce((total, refund) => total + Number(refund.amount), 0);
    if (Number(amount) + alreadyRefunded > Number(payment.amount) + 0.005) { res.status(409).json({ error: "Refund amount exceeds the unrefunded Square payment amount" }); return; }
    const refund = (await client().createRefund({ paymentId: payment.squarePaymentId, amountCents: dollarsToCents(amount), reason })).refund;
    await db.transaction(async (tx) => {
      await tx.insert(squareRefundsTable).values({ paymentId: payment.id, squareRefundId: refund.id, amount: centsToDollars(refund.amount_money.amount), status: refund.status, reason: refund.reason ?? null }).onConflictDoNothing();
      if (refund.status === "COMPLETED") await reconcileInvoiceAccounting(tx, payment.invoiceId);
    });
    res.status(201).json({ id: refund.id, status: refund.status });
  } catch (err) { fail(res, err); }
});

router.get("/sync/:resource/preview", requirePermission("inventory", "view"), async (req, res): Promise<void> => {
  const params = parsed(PreviewSquareSyncParams.safeParse(req.params), res);
  if (!params) return;
  const resource = params.resource;
  try {
    if (resource === "customers") { const remote = await client().listCustomers(); const mapped = await db.select().from(squareMappingsTable).where(eq(squareMappingsTable.entityType, "customer")); res.json(PreviewSquareSyncResponse.parse({ resource, remote: remote.customers ?? [], mappedSquareIds: mapped.map((m) => m.squareId), policy: "Unmapped remote records require explicit review; no merge or delete occurs." })); return; }
    if (resource === "catalog" || resource === "inventory") { const remote = await client().searchCatalog(); res.json(PreviewSquareSyncResponse.parse({ resource, remote: remote.objects ?? [], policy: "Local parts/services are authoritative when pushed; no destructive delete occurs." })); return; }
    res.status(400).json({ error: "resource must be customers, catalog, or inventory" });
  } catch (err) { fail(res, err); }
});
router.post("/sync/:resource/apply", requirePermission("inventory", "edit"), async (req, res): Promise<void> => {
  const params = parsed(ApplySquareSyncParams.safeParse(req.params), res);
  const input = parsed(ApplySquareSyncBody.safeParse(req.body), res);
  if (!params || !input) return;
  const resource = params.resource;
  // Applying only acknowledges an explicit, reviewed sync request. Importing unmapped
  // records is intentionally not automatic; actual mappings are created per reviewed item.
  await db.insert(squareSyncStatesTable).values({ resource, lastSyncedAt: new Date(), lastError: null, updatedAt: new Date() }).onConflictDoUpdate({ target: squareSyncStatesTable.resource, set: { lastSyncedAt: new Date(), lastError: null, updatedAt: new Date() } });
  res.json(ApplySquareSyncResponse.parse({ resource, applied: 0, policy: "No destructive deletes and no unmapped remote imports were applied." }));
});

export default router;