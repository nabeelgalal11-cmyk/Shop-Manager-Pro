import { Router, type Request, type Response, type NextFunction } from "express";
import { db, customersTable, vehiclesTable, appointmentsTable, invoicesTable, lineItemsTable, paymentsTable } from "@workspace/db";
import { and, eq, ilike, or, desc } from "drizzle-orm";
import { createCheckoutSessionForInvoice } from "./invoices.js";
import { getStripeSettings } from "../lib/stripe.js";

const router: Router = Router();

// Per-IP rate limiter (simple in-memory)
const buckets = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 10;

function rateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
  const now = Date.now();
  const entry = buckets.get(ip);
  if (!entry || entry.resetAt < now) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return next();
  }
  if (entry.count >= MAX_PER_WINDOW) {
    return res.status(429).json({ error: "Too many requests, please try again shortly" });
  }
  entry.count++;
  next();
}

function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.APPOINTMENT_WEBHOOK_API_KEY;
  if (!expected) return res.status(503).json({ error: "Webhook not configured" });
  const provided =
    (req.headers["x-api-key"] as string) ||
    (req.headers.authorization || "").replace(/^Bearer\s+/i, "") ||
    (req.body && req.body.apiKey) ||
    (req.query.apiKey as string);
  if (!provided || provided !== expected) {
    return res.status(401).json({ error: "Invalid or missing API key" });
  }
  next();
}

// Allow cross-origin from anywhere on this single endpoint (your WP site posts here)
router.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, X-API-Key, Authorization");
  next();
});

router.options("/appointments", (_req, res) => res.sendStatus(204));

interface IncomingAppointment {
  // Customer
  firstName?: string;
  lastName?: string;
  fullName?: string; // Convenience: "John Doe" — split into first/last
  name?: string; // alias for fullName
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  // Vehicle
  year?: number | string;
  make?: string;
  model?: string;
  trim?: string;
  color?: string;
  licensePlate?: string;
  vin?: string;
  mileage?: number | string;
  // Appointment
  serviceType?: string;
  service?: string; // alias
  description?: string;
  preferredDate?: string; // YYYY-MM-DD
  preferredTime?: string; // HH:MM (24h)
  scheduledAt?: string; // full ISO override
  notes?: string;
  source?: string;
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "(Unknown)" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function parseScheduled(b: IncomingAppointment): Date {
  if (b.scheduledAt) {
    const d = new Date(b.scheduledAt);
    if (!isNaN(d.getTime())) return d;
  }
  if (b.preferredDate) {
    const time = (b.preferredTime || "09:00").trim();
    // Build ISO-like string assuming local time
    const iso = `${b.preferredDate}T${time.length === 5 ? time : time + ":00"}:00`;
    const d = new Date(iso);
    if (!isNaN(d.getTime())) return d;
  }
  // fallback: 24h from now
  return new Date(Date.now() + 24 * 60 * 60 * 1000);
}

router.post("/appointments", rateLimit, requireApiKey, async (req, res) => {
  try {
    const b: IncomingAppointment = req.body || {};

    // ---- Resolve customer name ----
    let firstName = (b.firstName || "").trim();
    let lastName = (b.lastName || "").trim();
    if (!firstName && !lastName) {
      const full = (b.fullName || b.name || "").trim();
      if (full) {
        const { first, last } = splitName(full);
        firstName = first; lastName = last;
      }
    }
    if (!firstName) firstName = "Web";
    if (!lastName) lastName = "Request";

    const email = (b.email || "").trim().toLowerCase() || null;
    const phone = (b.phone || "").trim() || null;

    if (!email && !phone) {
      return res.status(400).json({ error: "Either email or phone is required" });
    }

    // ---- Find or create customer (match by email OR phone) ----
    let customer = null as null | typeof customersTable.$inferSelect;
    const matchConds = [];
    if (email) matchConds.push(ilike(customersTable.email, email));
    if (phone) matchConds.push(eq(customersTable.phone, phone));
    if (matchConds.length > 0) {
      const [found] = await db
        .select()
        .from(customersTable)
        .where(matchConds.length === 1 ? matchConds[0] : or(...matchConds))
        .limit(1);
      if (found) customer = found;
    }
    if (!customer) {
      const [created] = await db
        .insert(customersTable)
        .values({
          firstName, lastName, email, phone,
          address: b.address || null,
          city: b.city || null,
          state: b.state || null,
          zip: b.zip || null,
          notes: `Created via web form${b.source ? ` (${b.source})` : ""}`,
        })
        .returning();
      customer = created;
    }

    // ---- Find or create vehicle (match by plate or VIN within this customer) ----
    let vehicleId: number | null = null;
    const yearNum = b.year ? Number(b.year) : NaN;
    const plate = (b.licensePlate || "").trim().toUpperCase();
    const vin = (b.vin || "").trim().toUpperCase();
    const make = (b.make || "").trim();
    const model = (b.model || "").trim();

    if (plate || vin || (make && model && !isNaN(yearNum))) {
      const conds: any[] = [eq(vehiclesTable.customerId, customer.id)];
      if (plate) conds.push(eq(vehiclesTable.licensePlate, plate));
      else if (vin) conds.push(eq(vehiclesTable.vin, vin));
      const [foundV] = plate || vin
        ? await db.select().from(vehiclesTable).where(and(...conds)).limit(1)
        : [];
      if (foundV) {
        vehicleId = foundV.id;
      } else if (make && model && !isNaN(yearNum)) {
        const [createdV] = await db
          .insert(vehiclesTable)
          .values({
            customerId: customer.id,
            year: yearNum,
            make, model,
            trim: b.trim || null,
            color: b.color || null,
            licensePlate: plate || null,
            vin: vin || null,
            mileage: b.mileage ? Number(b.mileage) : null,
          })
          .returning();
        vehicleId = createdV.id;
      }
    }

    // ---- Create appointment ----
    const serviceType = (b.serviceType || b.service || "Service Request").trim();
    const scheduledAt = parseScheduled(b);
    const sourceTag = b.source ? `[${b.source}] ` : "[Web Form] ";

    const [appointment] = await db
      .insert(appointmentsTable)
      .values({
        customerId: customer.id,
        vehicleId,
        status: "pending",
        serviceType,
        description: b.description || null,
        scheduledAt,
        notes: sourceTag + (b.notes || ""),
      })
      .returning();

    req.log?.info(
      { appointmentId: appointment.id, customerId: customer.id, vehicleId, source: b.source },
      "Public appointment request received",
    );

    res.status(201).json({
      ok: true,
      message: "Appointment request received. We'll contact you to confirm.",
      appointmentId: appointment.id,
    });
  } catch (err: any) {
    req.log?.error({ err }, "Public appointment intake failed");
    res.status(500).json({ error: "Failed to submit appointment request" });
  }
});

// ---- PUBLIC INVOICE PAY PAGE ----
// Token-protected, no auth required. The token is generated by the admin
// "Send pay link" action; possession of the token proves the customer was
// invited to view + pay this specific invoice.

const payBuckets = new Map<string, { count: number; resetAt: number }>();
const PAY_WINDOW_MS = 60 * 1000;
const PAY_MAX = 30;
function payRateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
  const now = Date.now();
  const entry = payBuckets.get(ip);
  if (!entry || entry.resetAt < now) {
    payBuckets.set(ip, { count: 1, resetAt: now + PAY_WINDOW_MS });
    return next();
  }
  if (entry.count >= PAY_MAX) return res.status(429).json({ error: "Too many requests" });
  entry.count++;
  next();
}

router.get("/invoices/:token", payRateLimit, async (req, res) => {
  const token = String(req.params.token ?? "");
  if (!token || token.length < 8) return res.status(404).json({ error: "Not found" });
  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.publicToken, token));
  if (!invoice) return res.status(404).json({ error: "Not found" });

  const [items, payments, customer] = await Promise.all([
    db.select().from(lineItemsTable).where(eq(lineItemsTable.invoiceId, invoice.id)),
    db.select().from(paymentsTable).where(eq(paymentsTable.invoiceId, invoice.id)).orderBy(desc(paymentsTable.paidAt)),
    db.select().from(customersTable).where(eq(customersTable.id, invoice.customerId)).then(r => r[0]),
  ]);

  const settings = await getStripeSettings();
  res.json({
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    createdAt: invoice.createdAt,
    dueDate: invoice.dueDate,
    subtotal: invoice.subtotal,
    taxAmount: invoice.taxAmount,
    discountAmount: invoice.discountAmount,
    total: invoice.total,
    amountPaid: invoice.amountPaid,
    balance: invoice.balance,
    notes: invoice.notes,
    customer: customer ? { firstName: customer.firstName, lastName: customer.lastName, email: customer.email } : null,
    lineItems: items.map(i => ({
      description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, total: i.total, type: i.type,
    })),
    payments: payments
      .filter(p => p.status === "succeeded")
      .map(p => ({
        amount: p.amount, method: p.method, paidAt: p.paidAt, referenceNumber: p.referenceNumber,
      })),
    // Both pieces are required for the end-to-end flow: secretKey to create
    // the Checkout Session, webhookSecret so the success webhook can mark
    // the invoice paid. Hide the button if either is missing.
    paymentsEnabled: !!settings.secretKey && !!settings.webhookSecret,
    shopName: process.env.SHOP_NAME || "Our Shop",
  });
});

// Customer hits /pay/:token/cancelled (Stripe cancel_url) — record an
// explicit "cancelled" attempt so the shop sees it in the timeline without
// waiting for checkout.session.expired (which can take ~24h).
router.post("/invoices/:token/cancel", payRateLimit, async (req, res) => {
  const token = String(req.params.token ?? "");
  if (!token) return res.status(404).json({ error: "Not found" });
  const [invoice] = await db.select({ id: invoicesTable.id, stripeSessionId: invoicesTable.stripeSessionId })
    .from(invoicesTable).where(eq(invoicesTable.publicToken, token));
  if (!invoice) return res.status(404).json({ error: "Not found" });

  // Idempotent per session: only record once per session id.
  if (invoice.stripeSessionId) {
    const existing = await db.select().from(paymentsTable).where(and(
      eq(paymentsTable.referenceNumber, invoice.stripeSessionId),
      eq(paymentsTable.status, "cancelled"),
    ));
    if (existing.length === 0) {
      await db.insert(paymentsTable).values({
        invoiceId: invoice.id,
        amount: "0",
        method: "stripe",
        status: "cancelled",
        failureReason: "Customer cancelled at Stripe Checkout",
        referenceNumber: invoice.stripeSessionId,
        notes: "Stripe Checkout cancelled by customer",
        paidAt: new Date(),
      });
    }
  }
  res.json({ ok: true });
});

router.post("/invoices/:token/checkout-session", payRateLimit, async (req, res) => {
  const token = String(req.params.token ?? "");
  if (!token) return res.status(404).json({ error: "Not found" });
  const [invoice] = await db.select({ id: invoicesTable.id }).from(invoicesTable).where(eq(invoicesTable.publicToken, token));
  if (!invoice) return res.status(404).json({ error: "Not found" });
  try {
    const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "")
      || (req.headers["x-forwarded-host"] && `${req.protocol}://${req.headers["x-forwarded-host"]}`)
      || `${req.protocol}://${req.get("host")}`;
    const out = await createCheckoutSessionForInvoice(invoice.id, base);
    res.json(out);
  } catch (err: any) {
    const status = err.status ?? 500;
    req.log?.warn({ err: err.message, invoiceId: invoice.id }, "Public checkout session create failed");
    res.status(status).json({ error: err.message ?? "Unable to start payment" });
  }
});

export default router;
