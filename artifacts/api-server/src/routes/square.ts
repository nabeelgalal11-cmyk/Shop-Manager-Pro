import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { db, invoicesTable, paymentsTable, squareMappingsTable, squareSyncStatesTable } from "@workspace/db";
import { ApplySquareSyncBody, ApplySquareSyncParams, ApplySquareSyncResponse, CreateSquareInvoicePaymentBody, CreateSquareInvoicePaymentParams, CreateSquareRefundBody, GetSquareStatusResponse, PreviewSquareSyncParams, PreviewSquareSyncResponse } from "@workspace/api-zod";
import { getUser, requirePermission } from "../lib/auth.js";
import { SquareClient, SquareError, dollarsToCents } from "../lib/square.js";
import { reconcileSquarePayment } from "../lib/square-accounting.js";
import { reconcileProcessorRefund } from "../lib/repair-workflow.js";

const router: IRouter = Router();
const client = () => new SquareClient();
const fail = (res: any, err: unknown) => { const e = err instanceof SquareError ? err : new SquareError(err instanceof Error ? err.message : "Square operation failed", 502); res.status(e.status).json({ error: e.message, code: e.code }); };
const parsed = <T,>(result: { success: boolean; data?: T; error?: { message: string } }, res: any): T | null => { if (result.success) return result.data as T; res.status(400).json({ error: result.error?.message ?? "Invalid request" }); return null; };
type PosState = { invoiceId: number; amountCents: number; userId: number; locationId: string; nonce: string; exp: number };
const stateSecret = () => process.env.SESSION_SECRET || (process.env.NODE_ENV === "production" ? (() => { throw new SquareError("SESSION_SECRET is required for mobile payments", 503); })() : "dev-only-insecure-secret");
const signState = (value: PosState) => { const data = Buffer.from(JSON.stringify(value)).toString("base64url"); return `${data}.${createHmac("sha256", stateSecret()).update(data).digest("base64url")}`; };
function readState(value: string): PosState {
  const [data, signature, extra] = value.split("."), expected = createHmac("sha256", stateSecret()).update(data ?? "").digest();
  const actual = Buffer.from(signature ?? "", "base64url");
  if (!data || !signature || extra || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new SquareError("Invalid payment state", 400);
  const state = JSON.parse(Buffer.from(data, "base64url").toString()) as PosState;
  if (!Number.isSafeInteger(state.invoiceId) || !Number.isSafeInteger(state.amountCents) || state.amountCents <= 0 || !state.locationId || !state.nonce || state.exp <= Date.now()) throw new SquareError("Payment state is invalid or expired", 400);
  return state;
}

router.get("/status", requirePermission("payments", "view"), async (_req, res): Promise<void> => { try { const locations = await client().locations(); res.json(GetSquareStatusResponse.parse({ configured: true, environment: process.env.SQUARE_ENVIRONMENT ?? "sandbox", locations: locations.locations.map((l) => ({ id: l.id, name: l.name, status: l.status })) })); } catch (err) { fail(res, err); } });

router.post("/invoices/:invoiceId/payment", requirePermission("payments", "create"), async (req, res): Promise<void> => {
  const params = parsed(CreateSquareInvoicePaymentParams.safeParse(req.params), res), input = parsed(CreateSquareInvoicePaymentBody.safeParse(req.body), res);
  if (!params || !input) return;
  try {
    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, params.invoiceId));
    if (!invoice || !["issued", "partially_paid"].includes(invoice.status) || Number(invoice.balance) <= 0) throw new SquareError("Invoice is not open for payment", 409);
    const remote = (await client().createPayment({ sourceId: input.sourceId, locationId: input.locationId, amountCents: dollarsToCents(invoice.balance), referenceId: `invoice:${invoice.id}` })).payment;
    const result = await reconcileSquarePayment(remote, invoice.id, `square-api:${remote.id}`);
    res.status(201).json({ paymentId: result?.payment.id ?? remote.id, status: remote.status });
  } catch (err) { fail(res, err); }
});

router.post("/pos/prepare", requirePermission("payments", "create"), async (req, res): Promise<void> => {
  try {
    const invoiceId = Number(req.body?.invoiceId), amountCents = dollarsToCents(req.body?.amount);
    if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0 || amountCents <= 0) throw new SquareError("A valid invoice and positive payment amount are required", 400);
    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
    if (!invoice || !["issued", "partially_paid"].includes(invoice.status) || amountCents > dollarsToCents(invoice.balance)) throw new SquareError("Invoice is not open for this payment amount", 409);
    const locations = (await client().locations()).locations.filter((l) => l.status === "ACTIVE");
    const location = req.body?.locationId ? locations.find((l) => l.id === String(req.body.locationId)) : locations[0];
    if (!location?.id || !process.env.SQUARE_APPLICATION_ID?.trim()) throw new SquareError("Square is not configured for POS payments", 503);
    const state: PosState = { invoiceId, amountCents, userId: getUser(req)!.id, locationId: location.id, nonce: randomBytes(12).toString("base64url"), exp: Date.now() + 600_000 };
    res.json({ amountMoney: { amount: amountCents, currencyCode: "USD" }, callbackUrl: "motors915://square-callback", clientId: process.env.SQUARE_APPLICATION_ID, options: { supportedTenderTypes: ["CREDIT_CARD"] }, version: "1.3", locationId: location.id, state: signState(state), notes: `Invoice ${invoice.invoiceNumber} [915:${state.nonce}]`, expiresAt: new Date(state.exp).toISOString() });
  } catch (err) { fail(res, err); }
});

router.post("/pos/complete", requirePermission("payments", "create"), async (req, res): Promise<void> => {
  try {
    const state = readState(String(req.body?.state ?? "")), paymentId = String(req.body?.paymentId ?? "").trim();
    if (!paymentId || getUser(req)!.id !== state.userId) throw new SquareError("Invalid POS payment completion", 403);
    const payment = (await client().getPayment(paymentId)).payment;
    if (payment.location_id !== state.locationId || payment.amount_money?.currency !== "USD" || payment.amount_money?.amount !== state.amountCents || !String(payment.note ?? "").includes(`[915:${state.nonce}]`)) throw new SquareError("Square payment verification failed", 409);
    const result = await reconcileSquarePayment(payment, state.invoiceId, `square-pos:${payment.id}`);
    res.json({ paymentId: result?.payment.id ?? payment.id, status: payment.status, invoiceId: state.invoiceId });
  } catch (err) { fail(res, err); }
});

router.all("/terminal/{*path}", requirePermission("payments", "view"), async (_req, res): Promise<void> => { res.status(410).json({ error: "Square Terminal checkouts are unavailable with the immutable payment ledger" }); });

router.post("/refunds", requirePermission("payments", "edit"), async (req, res): Promise<void> => {
  const input = parsed(CreateSquareRefundBody.safeParse(req.body), res); if (!input) return;
  try {
    const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, input.paymentId));
    if (!payment || payment.processor !== "square" || !payment.processorPaymentId || payment.status !== "succeeded") throw new SquareError("Payment is not a completed Square payment", 409);
    const refund = (await client().createRefund({ paymentId: payment.processorPaymentId, amountCents: dollarsToCents(input.amount), reason: input.reason })).refund;
    if (refund.status === "COMPLETED") await reconcileProcessorRefund({ processor: "square", processorPaymentId: payment.processorPaymentId, refundId: refund.id, eventId: `square-refund:${refund.id}`, amount: (refund.amount_money.amount / 100).toFixed(2), reason: refund.reason });
    res.status(201).json({ id: refund.id, status: refund.status });
  } catch (err) { fail(res, err); }
});

router.get("/sync/:resource/preview", requirePermission("inventory", "view"), async (req, res): Promise<void> => { const params = parsed(PreviewSquareSyncParams.safeParse(req.params), res); if (!params) return; try { const resource = params.resource; if (resource === "customers") { const remote = await client().listCustomers(); const mapped = await db.select().from(squareMappingsTable).where(eq(squareMappingsTable.entityType, "customer")); res.json(PreviewSquareSyncResponse.parse({ resource, remote: remote.customers ?? [], mappedSquareIds: mapped.map((m) => m.squareId), policy: "Unmapped remote records require explicit review; no merge or delete occurs." })); return; } if (resource === "catalog" || resource === "inventory") { const remote = await client().searchCatalog(); res.json(PreviewSquareSyncResponse.parse({ resource, remote: remote.objects ?? [], policy: "Local parts/services are authoritative when pushed; no destructive delete occurs." })); return; } res.status(400).json({ error: "resource must be customers, catalog, or inventory" }); } catch (err) { fail(res, err); } });
router.post("/sync/:resource/apply", requirePermission("inventory", "edit"), async (req, res): Promise<void> => { const params = parsed(ApplySquareSyncParams.safeParse(req.params), res), input = parsed(ApplySquareSyncBody.safeParse(req.body), res); if (!params || !input) return; await db.insert(squareSyncStatesTable).values({ resource: params.resource, lastSyncedAt: new Date(), lastError: null, updatedAt: new Date() }).onConflictDoUpdate({ target: squareSyncStatesTable.resource, set: { lastSyncedAt: new Date(), lastError: null, updatedAt: new Date() } }); res.json(ApplySquareSyncResponse.parse({ resource: params.resource, applied: 0, policy: "No destructive deletes and no unmapped remote imports were applied." })); });
export default router;