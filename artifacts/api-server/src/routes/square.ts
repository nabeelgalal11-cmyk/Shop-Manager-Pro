import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { db, invoicesTable, paymentsTable, squareMappingsTable, squareRefundsTable, squareSyncStatesTable, squareTerminalCheckoutsTable } from "@workspace/db";
import { ApplySquareSyncBody, ApplySquareSyncParams, ApplySquareSyncResponse, CancelSquareTerminalCheckoutParams, CancelSquareTerminalCheckoutResponse, CreateSquareInvoicePaymentBody, CreateSquareInvoicePaymentParams, CreateSquareTerminalCheckoutBody, CreateSquareRefundBody, GetSquareStatusResponse, GetSquareTerminalCheckoutParams, GetSquareTerminalCheckoutResponse, PreviewSquareSyncParams, PreviewSquareSyncResponse } from "@workspace/api-zod";
import { getUser, requirePermission } from "../lib/auth.js";
import { SquareClient, SquareError, centsToDollars, dollarsToCents } from "../lib/square.js";
import { reconcileInvoiceAccounting, reconcileSquarePayment } from "../lib/square-accounting.js";

const router: IRouter = Router();
const fail = (res: any, err: unknown) => {
  const e = err instanceof SquareError ? err : new SquareError("Square operation failed", 502);
  res.status(e.status).json({ error: e.message, code: e.code });
};
const client = () => new SquareClient();
const POS_CALLBACK_URL = "motors915://square-callback";
const POS_STATE_LIFETIME_MS = 10 * 60 * 1000;
type PosState = {
  invoiceId: number;
  amountCents: number;
  userId: number;
  locationId: string;
  nonce: string;
  exp: number;
};

function stateSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new SquareError("SESSION_SECRET is required for mobile payments", 503);
  }
  return secret || "dev-only-insecure-secret";
}

function signPosState(payload: PosState): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", stateSecret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyPosState(value: string): PosState {
  const [encoded, signature, extra] = value.split(".");
  if (!encoded || !signature || extra) throw new SquareError("Invalid payment state", 400);
  const expected = createHmac("sha256", stateSecret()).update(encoded).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new SquareError("Invalid payment state", 400);
  }
  let payload: PosState;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as PosState;
  } catch {
    throw new SquareError("Invalid payment state", 400);
  }
  if (
    !Number.isSafeInteger(payload.invoiceId) ||
    !Number.isSafeInteger(payload.amountCents) ||
    !Number.isSafeInteger(payload.userId) ||
    !Number.isSafeInteger(payload.exp) ||
    !payload.locationId ||
    !payload.nonce ||
    payload.exp <= Date.now()
  ) {
    throw new SquareError("Payment state is invalid or expired", 400);
  }
  return payload;
}
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

router.post("/pos/prepare", requirePermission("payments", "create"), async (req, res): Promise<void> => {
  try {
    const invoiceId = Number(req.body?.invoiceId);
    const amountCents = dollarsToCents(req.body?.amount);
    const requestedLocationId = req.body?.locationId ? String(req.body.locationId) : null;
    if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0 || amountCents <= 0) {
      throw new SquareError("A valid invoice and positive payment amount are required", 400);
    }
    const applicationId = process.env.SQUARE_APPLICATION_ID?.trim();
    if (!applicationId) throw new SquareError("Square application ID is not configured", 503, "SQUARE_NOT_CONFIGURED");
    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
    if (!invoice) throw new SquareError("Invoice not found", 404);
    if (invoice.status === "paid" || invoice.status === "void" || Number(invoice.balance) <= 0) {
      throw new SquareError("Invoice is not open for payment", 409);
    }
    if (amountCents > dollarsToCents(invoice.balance)) {
      throw new SquareError("Payment amount exceeds the outstanding invoice balance", 409);
    }
    const locations = (await client().locations()).locations;
    const activeLocations = locations.filter((location) => location.status === "ACTIVE");
    const location = requestedLocationId
      ? activeLocations.find((candidate) => candidate.id === requestedLocationId)
      : activeLocations[0];
    if (!location?.id) throw new SquareError("No matching active Square location is available", 409);
    const user = getUser(req)!;
    const expiresAt = new Date(Date.now() + POS_STATE_LIFETIME_MS);
    const statePayload: PosState = {
      invoiceId,
      amountCents,
      userId: user.id,
      locationId: location.id,
      nonce: randomBytes(12).toString("base64url"),
      exp: expiresAt.getTime(),
    };
    const notes = `Invoice ${invoice.invoiceNumber} [915:${statePayload.nonce}]`;
    res.json({
      amountMoney: { amount: amountCents, currencyCode: "USD" },
      callbackUrl: POS_CALLBACK_URL,
      clientId: applicationId,
      options: { supportedTenderTypes: ["CREDIT_CARD"] },
      version: "1.3",
      locationId: location.id,
      state: signPosState(statePayload),
      notes,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    fail(res, err);
  }
});

router.post("/pos/complete", requirePermission("payments", "create"), async (req, res): Promise<void> => {
  try {
    const state = verifyPosState(String(req.body?.state ?? ""));
    const paymentId = String(req.body?.paymentId ?? "").trim();
    if (!paymentId) throw new SquareError("Square payment ID is required", 400);
    if (getUser(req)!.id !== state.userId) throw new SquareError("Payment state belongs to another user", 403);
    let payment: any;
    try {
      payment = (await client().getPayment(paymentId)).payment;
    } catch (err) {
      if (err instanceof SquareError && (err.status === 404 || err.code === "NOT_FOUND")) {
        throw new SquareError(
          "Square returned a legacy transaction ID that cannot be verified through the Payments API; the invoice was not credited",
          409,
          "UNVERIFIABLE_POS_TRANSACTION",
        );
      }
      throw err;
    }
    if (!payment?.id) throw new SquareError("Square payment could not be verified", 409);
    if (payment.location_id !== state.locationId) throw new SquareError("Square payment location does not match", 409);
    if (payment.amount_money?.currency !== "USD" || payment.amount_money?.amount !== state.amountCents) {
      throw new SquareError("Square payment amount does not match", 409);
    }
    const marker = `[915:${state.nonce}]`;
    if (!String(payment.note ?? "").includes(marker)) {
      throw new SquareError("Square payment reference does not match", 409);
    }
    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, state.invoiceId));
    if (!invoice) throw new SquareError("Invoice not found", 404);
    const [existing] = await db.select().from(paymentsTable).where(eq(paymentsTable.squarePaymentId, payment.id));
    if (existing && existing.invoiceId !== state.invoiceId) {
      throw new SquareError("Square payment is already associated with another invoice", 409);
    }
    await db.transaction(async (tx) => {
      await tx.insert(paymentsTable).values({
        invoiceId: state.invoiceId,
        amount: "0",
        method: "square_pos",
        status: "pending",
        referenceNumber: payment.id,
        squarePaymentId: payment.id,
        notes: `Square POS app switch ${marker}`,
        paidAt: new Date(),
      }).onConflictDoNothing();
      await reconcileSquarePayment(tx, payment);
    });
    res.json({ paymentId: payment.id, status: payment.status, invoiceId: state.invoiceId });
  } catch (err) {
    fail(res, err);
  }
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