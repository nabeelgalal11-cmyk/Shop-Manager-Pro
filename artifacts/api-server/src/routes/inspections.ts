import { Router } from "express";
import { randomBytes } from "crypto";
import { db } from "@workspace/db";
import { inspectionsTable, vehiclesTable, employeesTable, customersTable } from "@workspace/db";
import { eq, sql, desc, and, isNull } from "drizzle-orm";
import { sendTemplatedEmail } from "../lib/email.js";
import { sendSms } from "../lib/sms.js";
import { recordActivity } from "../lib/activity.js";

const router: Router = Router();

// Per-item shape (forward-compatible — old data with {label, status, notes}
// keeps working since extra fields are optional). status: pass | attention |
// fail | not_inspected for the new DVI flow; legacy ok|needs_attention|urgent|na
// values are still accepted and rendered.
function normalizeItems(items: any): any[] {
  if (!Array.isArray(items)) return [];
  return items.map((it: any, idx: number) => ({
    id: it.id || `item-${idx}-${Date.now().toString(36)}`,
    label: String(it.label ?? ""),
    status: String(it.status ?? "not_inspected"),
    note: typeof it.note === "string" ? it.note : (typeof it.notes === "string" ? it.notes : ""),
    photos: Array.isArray(it.photos) ? it.photos.filter((p: any) => typeof p === "string") : [],
    customerDecision: it.customerDecision ?? null, // 'approved' | 'declined' | null
    decidedAt: it.decidedAt ?? null,
    estimatedCost: it.estimatedCost ?? null,
  }));
}

async function enrichInspection(inspection: any) {
  const [vehicle, inspector] = await Promise.all([
    db.select().from(vehiclesTable).where(eq(vehiclesTable.id, inspection.vehicleId)).then(r => r[0]),
    inspection.inspectedById ? db.select().from(employeesTable).where(eq(employeesTable.id, inspection.inspectedById)).then(r => r[0]) : Promise.resolve(null),
  ]);
  return { ...inspection, vehicle, inspector };
}

router.get("/", async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const vehicleId = req.query.vehicleId ? Number(req.query.vehicleId) : undefined;
  const offset = (page - 1) * limit;

  const inspections = await (vehicleId
    ? db.select().from(inspectionsTable).where(eq(inspectionsTable.vehicleId, vehicleId)).orderBy(desc(inspectionsTable.createdAt)).limit(limit).offset(offset)
    : db.select().from(inspectionsTable).orderBy(desc(inspectionsTable.createdAt)).limit(limit).offset(offset));
  const [countResult] = await db.select({ count: sql<number>`count(*)` }).from(inspectionsTable);
  const enriched = await Promise.all(inspections.map(enrichInspection));
  res.json({ data: enriched, total: Number(countResult.count), page, limit });
});

router.post("/", async (req, res) => {
  const { vehicleId, repairOrderId, inspectedById, type, mileage, overallCondition, items, notes } = req.body;
  const [inspection] = await db.insert(inspectionsTable).values({
    vehicleId, repairOrderId, inspectedById, type, mileage, overallCondition,
    items: normalizeItems(items),
    notes,
  }).returning();
  res.status(201).json(await enrichInspection(inspection));
});

router.get("/:id", async (req, res) => {
  const [inspection] = await db.select().from(inspectionsTable).where(eq(inspectionsTable.id, Number(req.params.id)));
  if (!inspection) return res.status(404).json({ error: "Inspection not found" });
  res.json(await enrichInspection(inspection));
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { vehicleId, repairOrderId, inspectedById, type, mileage, overallCondition, items, notes } = req.body;
  const [inspection] = await db.update(inspectionsTable).set({
    vehicleId, repairOrderId, inspectedById, type, mileage, overallCondition,
    items: normalizeItems(items),
    notes,
    updatedAt: new Date(),
  }).where(eq(inspectionsTable.id, id)).returning();
  if (!inspection) return res.status(404).json({ error: "Inspection not found" });
  res.json(await enrichInspection(inspection));
});

// Atomic: COALESCE keeps an existing token, otherwise installs a freshly
// minted one. Avoids the read-then-update race where two simultaneous /send
// or /public-link calls could mint divergent tokens.
async function ensurePublicToken(inspectionId: number): Promise<string> {
  const candidate = randomBytes(24).toString("base64url");
  const [row] = await db.update(inspectionsTable).set({
    publicToken: sql`COALESCE(${inspectionsTable.publicToken}, ${candidate})`,
    updatedAt: new Date(),
  }).where(eq(inspectionsTable.id, inspectionId))
    .returning({ publicToken: inspectionsTable.publicToken });
  if (!row?.publicToken) throw new Error("Inspection not found");
  return row.publicToken;
}

// Send the inspection to the customer over their preferred channel(s).
router.post("/:id/send", async (req, res) => {
  const id = Number(req.params.id);
  const [inspection] = await db.select().from(inspectionsTable).where(eq(inspectionsTable.id, id));
  if (!inspection) return res.status(404).json({ error: "Inspection not found" });
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, inspection.vehicleId));
  if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });
  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, vehicle.customerId));
  if (!customer) return res.status(404).json({ error: "Customer not found" });

  const token = await ensurePublicToken(id);
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "")
    || (req.headers["x-forwarded-host"] && `${req.protocol}://${req.headers["x-forwarded-host"]}`)
    || `${req.protocol}://${req.get("host")}`;
  const url = `${base}/inspection/${token}`;
  const shop = process.env.SHOP_NAME || "Our Shop";
  const vehicleInfo = `${vehicle.year ?? ""} ${vehicle.make ?? ""} ${vehicle.model ?? ""}`.trim();

  const channel = (customer.preferredChannel as "email" | "sms" | "both") ?? "email";
  const wantsEmail = channel === "email" || channel === "both";
  const wantsSms = channel === "sms" || channel === "both";

  let emailed = false, smsed = false;
  const errors: string[] = [];

  if (wantsEmail) {
    if (!customer.email) {
      errors.push("no email on file");
    } else {
      const r = await sendTemplatedEmail("inspection_sent", customer.email, {
        customerName: `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim() || "Customer",
        shopName: shop,
        vehicleInfo,
        inspectionUrl: url,
      });
      emailed = !!r.ok;
      if (!r.ok) errors.push(`email: ${r.error || "failed"}`);
    }
  }
  if (wantsSms) {
    const smsBody = `${shop}: Your vehicle inspection for ${vehicleInfo || "your vehicle"} is ready. View & approve work here: ${url} — Reply STOP to opt out.`;
    const r = await sendSms({
      customerId: customer.id,
      body: smsBody,
      sentByUserId: (req as any).user?.id ?? null,
    });
    smsed = r.ok;
    if (!r.ok) errors.push(`sms: ${r.error || r.reason || "failed"}`);
  }

  if (emailed || smsed) {
    await db.update(inspectionsTable).set({ sentAt: new Date(), updatedAt: new Date() }).where(eq(inspectionsTable.id, id));
    await recordActivity({
      entityType: "inspection",
      entityId: id,
      eventType: "inspection_sent",
      meta: { emailed, smsed, channel },
      customerId: customer.id ?? null,
      req,
    });
    if (emailed) {
      await recordActivity({
        entityType: "inspection",
        entityId: id,
        eventType: "email_sent",
        meta: { template: "inspection_sent", to: customer.email },
        customerId: customer.id ?? null,
        req,
      });
    }
    if (smsed) {
      await recordActivity({
        entityType: "inspection",
        entityId: id,
        eventType: "sms_sent",
        meta: { context: "inspection_sent" },
        customerId: customer.id ?? null,
        req,
      });
    }
  }

  res.json({ ok: emailed || smsed, emailed, smsed, channel, url, token, errors });
});

// Generate (or fetch) the public link without sending — for "copy link" UI.
router.post("/:id/public-link", async (req, res) => {
  const id = Number(req.params.id);
  const [inspection] = await db.select({ id: inspectionsTable.id }).from(inspectionsTable).where(eq(inspectionsTable.id, id));
  if (!inspection) return res.status(404).json({ error: "Inspection not found" });
  const token = await ensurePublicToken(id);
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "")
    || (req.headers["x-forwarded-host"] && `${req.protocol}://${req.headers["x-forwarded-host"]}`)
    || `${req.protocol}://${req.get("host")}`;
  res.json({ token, url: `${base}/inspection/${token}` });
});

export default router;
