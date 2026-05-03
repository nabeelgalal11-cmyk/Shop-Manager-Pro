import { Router } from "express";
import { db } from "@workspace/db";
import { repairOrdersTable, customersTable, vehiclesTable, employeesTable, remindersTable, usedCarsTable } from "@workspace/db";
import { eq, sql, desc, and, gte } from "drizzle-orm";
import { sendTemplatedEmail } from "../lib/email.js";
import { sendSms } from "../lib/sms.js";
import { recordActivity } from "../lib/activity.js";
import { requirePermission } from "../lib/auth.js";
import { applyStockMovement, reverseStockMovement, getInventoryUnitCost, type DbExecutor } from "../lib/inventory.js";
import type { Action } from "../lib/permissions.js";
import { getUser } from "../lib/auth.js";
import { getPermissionsForRoles, hasPermission } from "../lib/permissions.js";
import {
  computeProfitability,
  getShopLaborRate,
  roProfitabilitySql,
  type RoProfitRow,
  type RoProfitability,
} from "../lib/profitability.js";

type EnrichedOrder = Record<string, unknown> & {
  id: number;
  marginPct?: number;
  profitability?: RoProfitability;
};

async function maybeSendCompletionEmail(order: any, req: any) {
  try {
    const customer = order.customer;
    if (!customer) return;
    const vehicle = order.vehicle;
    const vehicleInfo = vehicle
      ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") +
        (vehicle.licensePlate ? ` (${vehicle.licensePlate})` : "")
      : "your vehicle";
    const channel = customer.preferredChannel || "email";
    const shopName = process.env.SHOP_NAME || "Our Shop";

    const wantsEmail = channel === "email" || channel === "both";
    const wantsSms = channel === "sms" || channel === "both";

    if (wantsEmail && customer.email) {
      const result = await sendTemplatedEmail("repair_order_completed", customer.email, {
        customerName: `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim() || "Customer",
        customerEmail: customer.email,
        shopName,
        orderNumber: order.orderNumber,
        diagnosis: order.diagnosis || order.complaint || "Service completed",
        mileageOut: order.mileageOut ? String(order.mileageOut) : "—",
        vehicleInfo,
      });
      if (!result.ok) req.log?.warn({ err: result.error, id: order.id }, "Repair order completion email failed");
      else {
        await recordActivity({
          entityType: "repair_order",
          entityId: order.id,
          eventType: "email_sent",
          meta: { template: "repair_order_completed", to: customer.email },
          customerId: customer.id ?? null,
          req,
        });
      }
    }

    if (wantsSms && customer.phone && customer.id) {
      const body = `${shopName}: Your ${vehicleInfo} is ready for pickup (RO ${order.orderNumber}). Reply STOP to opt out.`;
      const result = await sendSms({
        customerId: customer.id,
        body,
        repairOrderId: order.id,
      });
      if (!result.ok) {
        req.log?.warn({ err: result.error, reason: result.reason, id: order.id }, "RO completion SMS failed");
      } else {
        await recordActivity({
          entityType: "repair_order",
          entityId: order.id,
          eventType: "sms_sent",
          meta: { to: customer.phone },
          customerId: customer.id ?? null,
          req,
        });
      }
    }
  } catch (err) {
    req.log?.error({ err }, "maybeSendCompletionEmail crashed");
  }
}

const router: Router = Router();

router.use((req, res, next) => {
  const action: Action =
    req.method === "GET" ? "view" :
    req.method === "POST" ? "create" :
    req.method === "DELETE" ? "delete" :
    "edit";
  return requirePermission("repair_orders", action)(req, res, next);
});

// ── Service keyword → reminder interval ────────────────────────────────────
interface ServiceInterval { serviceType: string; months: number; miles?: number }

const SERVICE_INTERVALS: Array<{ keywords: string[]; serviceType: string; months: number; miles?: number }> = [
  { keywords: ["oil change", "oil service", "lube"],      serviceType: "Oil Change",               months: 3,  miles: 3000  },
  { keywords: ["tire rotation", "rotate tires"],          serviceType: "Tire Rotation",             months: 6,  miles: 5000  },
  { keywords: ["brake"],                                   serviceType: "Brake Inspection",          months: 12                },
  { keywords: ["air filter"],                              serviceType: "Air Filter Replacement",    months: 12, miles: 15000 },
  { keywords: ["cabin filter"],                            serviceType: "Cabin Filter Replacement",  months: 12, miles: 15000 },
  { keywords: ["transmission service", "trans service"],  serviceType: "Transmission Service",      months: 24, miles: 30000 },
  { keywords: ["coolant", "antifreeze"],                  serviceType: "Coolant Flush",             months: 24               },
  { keywords: ["battery"],                                 serviceType: "Battery Check",             months: 12               },
  { keywords: ["spark plug"],                              serviceType: "Spark Plug Replacement",    months: 24, miles: 30000 },
  { keywords: ["timing belt"],                             serviceType: "Timing Belt Service",       months: 48, miles: 60000 },
  { keywords: ["alignment"],                               serviceType: "Alignment",                 months: 12               },
  { keywords: ["multi-point", "multipoint", "inspection"], serviceType: "Multi-Point Inspection",   months: 12               },
];

function detectServices(text: string): ServiceInterval[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const found: ServiceInterval[] = [];
  for (const entry of SERVICE_INTERVALS) {
    if (entry.keywords.some(k => lower.includes(k))) {
      found.push({ serviceType: entry.serviceType, months: entry.months, miles: entry.miles });
    }
  }
  return found;
}

function addMonths(date: Date, months: number): string {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split("T")[0];
}

async function autoCreateReminders(order: any) {
  const text = `${order.complaint ?? ""} ${order.diagnosis ?? ""} ${order.notes ?? ""}`;
  const services = detectServices(text);
  if (!services.length) return;

  const today = new Date().toISOString().split("T")[0];

  await Promise.allSettled(
    services.map(async (svc) => {
      // Skip if a future reminder already exists for this customer + vehicle + service
      const existing = await db
        .select({ id: remindersTable.id })
        .from(remindersTable)
        .where(
          and(
            eq(remindersTable.customerId, order.customerId),
            order.vehicleId ? eq(remindersTable.vehicleId, order.vehicleId) : undefined,
            eq(remindersTable.serviceType, svc.serviceType),
            gte(remindersTable.dueDate, today),
          )
        )
        .limit(1);

      if (existing.length > 0) return;

      const dueDate = addMonths(new Date(), svc.months);
      const dueMileage =
        svc.miles && order.mileageOut
          ? Number(order.mileageOut) + svc.miles
          : svc.miles && order.mileageIn
          ? Number(order.mileageIn) + svc.miles
          : undefined;

      await db.insert(remindersTable).values({
        customerId: order.customerId,
        vehicleId: order.vehicleId ?? null,
        serviceType: svc.serviceType,
        dueDate,
        dueMileage: dueMileage ?? null,
        notes: `Auto-created from repair order ${order.orderNumber}`,
        sent: false,
      });
    })
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function enrichOrder(order: any) {
  const [customer, vehicle, assignedTo, usedCar] = await Promise.all([
    order.customerId ? db.select().from(customersTable).where(eq(customersTable.id, order.customerId)).then(r => r[0]) : Promise.resolve(null),
    order.vehicleId ? db.select().from(vehiclesTable).where(eq(vehiclesTable.id, order.vehicleId)).then(r => r[0]) : Promise.resolve(null),
    order.assignedToId ? db.select().from(employeesTable).where(eq(employeesTable.id, order.assignedToId)).then(r => r[0]) : Promise.resolve(null),
    order.usedCarId ? db.select().from(usedCarsTable).where(eq(usedCarsTable.id, order.usedCarId)).then(r => r[0]) : Promise.resolve(null),
  ]);
  return { ...order, customer, vehicle, assignedTo, usedCar };
}

async function userCanViewReports(req: any): Promise<boolean> {
  const u = getUser(req);
  if (!u) return false;
  if (u.roles.includes("admin")) return true;
  const perms = await getPermissionsForRoles(u.roles);
  return hasPermission(perms, "reports", "view");
}

// ── Routes ──────────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const status = req.query.status as string | undefined;
  const offset = (page - 1) * limit;

  const orders = await (status
    ? db.select().from(repairOrdersTable).where(eq(repairOrdersTable.status, status)).orderBy(desc(repairOrdersTable.createdAt), desc(repairOrdersTable.id)).limit(limit).offset(offset)
    : db.select().from(repairOrdersTable).orderBy(desc(repairOrdersTable.createdAt), desc(repairOrdersTable.id)).limit(limit).offset(offset));

  const [countResult] = await (status
    ? db.select({ count: sql<number>`count(*)` }).from(repairOrdersTable).where(eq(repairOrdersTable.status, status))
    : db.select({ count: sql<number>`count(*)` }).from(repairOrdersTable));

  const enriched = (await Promise.all(orders.map(enrichOrder))) as EnrichedOrder[];

  // Add per-row marginPct in a single CTE-style query to avoid N+1.
  if (orders.length > 0 && (await userCanViewReports(req))) {
    const ids = orders.map(o => o.id);
    const laborRate = await getShopLaborRate();
    const profitRows = await db.execute(
      sql`${roProfitabilitySql(sql`ro.id IN (${sql.join(ids.map(i => sql`${i}`), sql`,`)})`)}`
    );
    const profitMap = new Map<number, number>();
    for (const r of profitRows.rows as unknown as RoProfitRow[]) {
      profitMap.set(Number(r.id), computeProfitability(r, laborRate).grossMarginPct);
    }
    for (const e of enriched) {
      const m = profitMap.get(e.id);
      if (m !== undefined) e.marginPct = m;
    }
  }

  res.json({ data: enriched, total: Number(countResult.count), page, limit });
});

router.post("/", async (req, res) => {
  const { customerId, vehicleId, usedCarId, internal, assignedToId, status, priority, complaint, diagnosis, notes, parts, estimatedHours, mileageIn, promisedDate } = req.body;
  const isInternal = Boolean(internal) || (usedCarId != null && !customerId);
  if (!isInternal && (!customerId || !vehicleId)) {
    return res.status(400).json({ error: "Customer and vehicle are required for non-internal repair orders" });
  }
  if (isInternal && !usedCarId) {
    return res.status(400).json({ error: "Used car is required for internal repair orders" });
  }

  // If the RO is being created already in `completed` status, the row
  // insert + inventory consumption must be one atomic unit so the ledger
  // stays in sync (mirrors the invoice/purchase create-time behavior).
  let order: any;
  try {
    order = await db.transaction(async (tx) => {
      const [lastOrder] = await tx.select({ orderNumber: repairOrdersTable.orderNumber }).from(repairOrdersTable).orderBy(desc(repairOrdersTable.id)).limit(1);
      const nextNum = lastOrder ? Number(lastOrder.orderNumber.replace("RO-", "")) + 1 : 1001;
      const orderNumber = `RO-${nextNum}`;

      const initialStatus = status || "pending";
      const [created] = await tx.insert(repairOrdersTable).values({
        orderNumber,
        customerId: customerId || null,
        vehicleId: vehicleId || null,
        usedCarId: usedCarId || null,
        internal: isInternal,
        assignedToId, status: initialStatus, priority: priority || "normal",
        complaint, diagnosis, notes,
        parts: parts ?? undefined,
        estimatedHours, mileageIn,
        promisedDate: promisedDate ? new Date(promisedDate) : null,
        completedAt: initialStatus === "completed" ? new Date() : null,
      }).returning();

      if (initialStatus === "completed") {
        await applyRepairOrderConsumption(created, tx);
      }
      return created;
    });
  } catch (err) {
    req.log?.error({ err }, "RO create transaction failed");
    return res.status(500).json({ error: "Failed to create repair order" });
  }

  await recordActivity({
    entityType: "repair_order",
    entityId: order.id,
    eventType: "created",
    meta: { orderNumber: order.orderNumber, status: order.status, customerId: order.customerId, vehicleId: order.vehicleId },
    customerId: order.customerId ?? null,
    req,
  });
  if (order.assignedToId) {
    await recordActivity({
      entityType: "repair_order",
      entityId: order.id,
      eventType: "assigned",
      meta: { assignedToId: order.assignedToId },
      customerId: order.customerId ?? null,
      req,
    });
  }

  res.status(201).json(await enrichOrder(order));
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [order] = await db.select().from(repairOrdersTable).where(eq(repairOrdersTable.id, id));
  if (!order) return res.status(404).json({ error: "Repair order not found" });
  const enriched = (await enrichOrder(order)) as EnrichedOrder;

  if (await userCanViewReports(req)) {
    const laborRate = await getShopLaborRate();
    const rows = await db.execute(sql`${roProfitabilitySql(sql`ro.id = ${id}`)}`);
    const r = (rows.rows as unknown as RoProfitRow[])[0];
    if (r) {
      enriched.profitability = computeProfitability(r, laborRate);
    }
  }

  res.json(enriched);
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { orderNumber, vehicleId, assignedToId, status, priority, complaint, diagnosis, notes, parts, estimatedHours, actualHours, mileageIn, mileageOut, promisedDate, completedAt, createdAt } = req.body;

  // Validate orderNumber up-front (cheap pre-check; conflict re-checked in tx).
  if (orderNumber !== undefined) {
    const trimmed = String(orderNumber).trim();
    if (!trimmed) return res.status(400).json({ error: "Order number cannot be empty" });
  }

  // Wrap status update + inventory consumption / reversal in a single
  // transaction. Either both succeed or neither does — prevents the
  // ledger from drifting out of sync with RO status.
  type Result =
    | { kind: "ok"; order: any; prevStatus: string | undefined }
    | { kind: "error"; status: number; error: string };

  let result: Result;
  try {
    result = await db.transaction(async (tx): Promise<Result> => {
      const [prev] = await tx.select({ status: repairOrdersTable.status, parts: repairOrdersTable.parts })
        .from(repairOrdersTable).where(eq(repairOrdersTable.id, id));

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (orderNumber !== undefined) {
        const trimmed = String(orderNumber).trim();
        const [conflict] = await tx
          .select({ id: repairOrdersTable.id })
          .from(repairOrdersTable)
          .where(and(eq(repairOrdersTable.orderNumber, trimmed), sql`${repairOrdersTable.id} <> ${id}`))
          .limit(1);
        if (conflict) return { kind: "error", status: 409, error: `Order number ${trimmed} is already in use` };
        updates.orderNumber = trimmed;
      }
      if (vehicleId !== undefined && vehicleId !== null && vehicleId !== "") updates.vehicleId = Number(vehicleId);
      if (assignedToId !== undefined) updates.assignedToId = assignedToId === null || assignedToId === "" ? null : Number(assignedToId);
      if (status !== undefined) updates.status = status;
      if (priority !== undefined) updates.priority = priority;
      if (complaint !== undefined) updates.complaint = complaint;
      if (diagnosis !== undefined) updates.diagnosis = diagnosis;
      if (notes !== undefined) updates.notes = notes;
      if (parts !== undefined) updates.parts = parts;
      if (estimatedHours !== undefined) updates.estimatedHours = estimatedHours === null || estimatedHours === "" ? null : estimatedHours;
      if (actualHours !== undefined) updates.actualHours = actualHours === null || actualHours === "" ? null : actualHours;
      if (mileageIn !== undefined) updates.mileageIn = mileageIn === null || mileageIn === "" ? null : Number(mileageIn);
      if (mileageOut !== undefined) updates.mileageOut = mileageOut === null || mileageOut === "" ? null : Number(mileageOut);
      if (promisedDate !== undefined) updates.promisedDate = promisedDate ? new Date(promisedDate) : null;
      if (createdAt !== undefined && createdAt !== null && createdAt !== "") updates.createdAt = new Date(createdAt);

      if (completedAt !== undefined) {
        updates.completedAt = completedAt ? new Date(completedAt) : null;
      } else if (status === "completed" && prev?.status !== "completed") {
        updates.completedAt = new Date();
      }

      const [order] = await tx.update(repairOrdersTable).set(updates).where(eq(repairOrdersTable.id, id)).returning();
      if (!order) return { kind: "error", status: 404, error: "Repair order not found" };

      // Apply inventory effects inside the same transaction so a movement
      // failure rolls back the status change.
      const wasCompleted = prev?.status === "completed";
      const isCompleted = order.status === "completed";
      const partsRewritten = parts !== undefined;

      if (!wasCompleted && isCompleted) {
        // Fresh completion → consume per current parts.
        await applyRepairOrderConsumption(order, tx);
      } else if (wasCompleted && !isCompleted) {
        // Leaving completed → reverse all prior consumption (use prev.parts so
        // we know which line indexes were originally consumed).
        await reverseRepairOrderConsumption({ id: order.id, parts: prev?.parts }, tx);
      } else if (wasCompleted && isCompleted && partsRewritten) {
        // Already-completed RO whose parts changed: reverse everything that
        // was previously consumed, then re-apply against the new parts list
        // — atomic with the row update so the ledger never drifts.
        await reverseRepairOrderConsumption({ id: order.id, parts: prev?.parts }, tx);
        await applyRepairOrderConsumption(order, tx);
      }

      return { kind: "ok", order, prevStatus: prev?.status };
    });
  } catch (err) {
    req.log?.error({ err, id }, "RO update transaction failed");
    return res.status(500).json({ error: "Failed to update repair order" });
  }

  if (result.kind === "error") return res.status(result.status).json({ error: result.error });

  const { order, prevStatus } = result;
  const enriched = await enrichOrder(order);

  // Audit: emit specific events for the fields that actually changed.
  if (status !== undefined && status !== prevStatus) {
    await recordActivity({
      entityType: "repair_order",
      entityId: order.id,
      eventType: "status_changed",
      meta: { from: prevStatus ?? null, to: order.status },
      customerId: order.customerId ?? null,
      req,
    });
  }
  if (assignedToId !== undefined) {
    await recordActivity({
      entityType: "repair_order",
      entityId: order.id,
      eventType: "assigned",
      meta: { assignedToId: order.assignedToId ?? null },
      customerId: order.customerId ?? null,
      req,
    });
  }
  if (notes !== undefined && notes !== null && String(notes).trim().length > 0) {
    await recordActivity({
      entityType: "repair_order",
      entityId: order.id,
      eventType: "note_added",
      meta: { length: String(notes).length },
      customerId: order.customerId ?? null,
      req,
    });
  }

  // Side effects that do NOT need to be transactional with the status
  // update (email send / reminder creation) run after commit.
  if (status === "completed" && prevStatus !== "completed" && !order.internal) {
    await autoCreateReminders(order).catch(() => {});
    await maybeSendCompletionEmail(enriched, req);
  }

  res.json(enriched);
});

async function applyRepairOrderConsumption(order: any, executor: DbExecutor = db) {
  const parts: Array<any> = Array.isArray(order.parts) ? order.parts : [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const invId = Number(p?.inventoryId);
    if (!Number.isFinite(invId) || invId <= 0) continue;
    const qty = Math.round(Number(p.quantity ?? 1));
    if (!Number.isFinite(qty) || qty === 0) continue;
    const unitCost = p.unitCost != null ? p.unitCost : await getInventoryUnitCost(invId, executor);
    await applyStockMovement({
      inventoryId: invId,
      delta: -qty,
      reason: "ro_consumed",
      referenceTable: "repair_orders",
      referenceId: order.id,
      referenceLineId: i,
      unitCost: unitCost ?? null,
    }, executor);
  }
}

async function reverseRepairOrderConsumption(order: any, executor: DbExecutor = db) {
  const parts: Array<any> = Array.isArray(order.parts) ? order.parts : [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const invId = Number(p?.inventoryId);
    if (!Number.isFinite(invId) || invId <= 0) continue;
    await reverseStockMovement({
      inventoryId: invId,
      originalReason: "ro_consumed",
      reverseReason: "ro_unconsumed",
      referenceTable: "repair_orders",
      referenceId: order.id,
      referenceLineId: i,
    }, executor);
  }
}

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  let deleted: { orderNumber: string; customerId: number | null } | null = null;
  try {
    deleted = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(repairOrdersTable).where(eq(repairOrdersTable.id, id));
      if (!existing) return null;
      // Reverse before delete (atomically) so completed-RO consumption
      // cannot be orphaned in the ledger.
      if (existing.status === "completed") {
        await reverseRepairOrderConsumption(existing, tx);
      }
      await tx.delete(repairOrdersTable).where(eq(repairOrdersTable.id, id));
      return { orderNumber: existing.orderNumber, customerId: existing.customerId ?? null };
    });
  } catch (err) {
    req.log?.error({ err, id }, "RO delete transaction failed");
    return res.status(500).json({ error: "Failed to delete repair order" });
  }
  if (deleted) {
    await recordActivity({
      entityType: "repair_order",
      entityId: id,
      eventType: "deleted",
      meta: { orderNumber: deleted.orderNumber },
      customerId: deleted.customerId,
      req,
    });
  }
  res.status(204).send();
});

export default router;
