import { Router, type IRouter } from "express";
import { db, estimateItemsTable, estimateRevisionsTable, invoiceItemsTable, invoicesTable, paymentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { decideRevision, WorkflowError } from "../lib/repair-workflow.js";
import { getStripeClient, getStripeSettings } from "../lib/stripe.js";

const router: IRouter = Router();
const error = (res: any, value: unknown) => {
  if (value instanceof WorkflowError) { res.status(value.status).json({ error: value.message }); return; }
  throw value;
};

/** Token-scoped public estimate view; no staff/customer lookup is exposed. */
router.get("/estimates/:token", async (req, res): Promise<void> => {
  const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;
  const [revision] = await db.select().from(estimateRevisionsTable).where(eq(estimateRevisionsTable.publicToken, token));
  if (!revision || revision.status !== "sent") { res.status(404).json({ error: "Estimate decision link not found" }); return; }
  const items = await db.select().from(estimateItemsTable).where(eq(estimateItemsTable.estimateRevisionId, revision.id));
  res.json({ revision: { id: revision.id, revisionNo: revision.revisionNo, kind: revision.kind, notes: revision.notes, customerSnapshot: revision.customerSnapshot, vehicleSnapshot: revision.vehicleSnapshot, subtotal: revision.subtotal, taxRateBps: revision.taxRateBps, taxAmount: revision.taxAmount, total: revision.total }, items });
});
router.post("/estimates/:token/decision", async (req, res): Promise<void> => {
  try {
    const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;
    res.json(await decideRevision(token, {
      signerName: String(req.body.signerName ?? ""),
      signerEmail: typeof req.body.signerEmail === "string" ? req.body.signerEmail : null,
      decision: req.body.decision,
      approvedItemIds: Array.isArray(req.body.approvedItemIds) ? req.body.approvedItemIds.map(Number) : [],
      declinedItemIds: Array.isArray(req.body.declinedItemIds) ? req.body.declinedItemIds.map(Number) : [],
      requestIp: req.ip,
      requestUserAgent: req.get("user-agent"),
    }));
  } catch (value) { error(res, value); }
});
router.get("/invoices/:token", async (req, res): Promise<void> => {
  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.publicToken, String(req.params.token)));
  if (!invoice || !["issued", "partially_paid"].includes(invoice.status)) { res.status(404).json({ error: "Invoice not found" }); return; }
  const [items, payments] = await Promise.all([
    db.select({ description: invoiceItemsTable.description, quantity: invoiceItemsTable.quantity, unitPrice: invoiceItemsTable.unitPrice, total: invoiceItemsTable.lineTotal, type: invoiceItemsTable.kind }).from(invoiceItemsTable).where(eq(invoiceItemsTable.invoiceId, invoice.id)),
    db.select({ amount: paymentsTable.amount, method: paymentsTable.method, processedAt: paymentsTable.processedAt, referenceNumber: paymentsTable.referenceNumber }).from(paymentsTable).where(eq(paymentsTable.invoiceId, invoice.id)),
  ]);
  // Snapshots intentionally do not expose contact details on a bearer link.
  res.json({ invoiceNumber: invoice.invoiceNumber, status: invoice.status, createdAt: invoice.createdAt, subtotal: invoice.subtotal, taxAmount: invoice.taxAmount, total: invoice.total, amountPaid: invoice.amountPaid, balance: invoice.balance, notes: invoice.notes, lineItems: items, payments });
});
router.post("/invoices/:token/checkout-session", async (req, res): Promise<void> => {
  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.publicToken, String(req.params.token)));
  if (!invoice || !["issued", "partially_paid"].includes(invoice.status) || Number(invoice.balance) <= 0) { res.status(404).json({ error: "Invoice is not available for payment" }); return; }
  try {
    const configuredBase = process.env.PUBLIC_BASE_URL;
    if (!configuredBase) throw new Error("PUBLIC_BASE_URL is not configured");
    const base = new URL(configuredBase);
    if (!["https:", "http:"].includes(base.protocol) || base.username || base.password) throw new Error("PUBLIC_BASE_URL must be an absolute HTTP(S) URL");
    const origin = base.href.replace(/\/$/, "");
    const stripeSettings = await getStripeSettings();
    if (!stripeSettings.secretKey || !stripeSettings.webhookSecret) throw new Error("Online payments are not fully configured");
    const stripe = await getStripeClient();
    const session = await stripe.checkout.sessions.create({
      mode: "payment", client_reference_id: String(invoice.id), metadata: { invoiceId: String(invoice.id) },
      line_items: [{ price_data: { currency: "usd", product_data: { name: `Invoice ${invoice.invoiceNumber}` }, unit_amount: Math.round(Number(invoice.balance) * 100) }, quantity: 1 }],
      success_url: `${origin}/pay/${req.params.token}/success`, cancel_url: `${origin}/pay/${req.params.token}/cancelled`,
    }, { idempotencyKey: `invoice-${invoice.id}-${invoice.version}` });
    res.json({ url: session.url });
  } catch { res.status(503).json({ error: "Online payments are unavailable" }); }
});
router.post("/invoices/:token/cancel", async (_req, res): Promise<void> => { res.status(204).send(); });
export default router;