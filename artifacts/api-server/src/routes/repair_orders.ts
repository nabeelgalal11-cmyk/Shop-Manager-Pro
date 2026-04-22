import { Router } from "express";
import { db } from "@workspace/db";
import { repairOrdersTable, customersTable, vehiclesTable, employeesTable, remindersTable } from "@workspace/db";
import { eq, sql, desc, and, gte } from "drizzle-orm";

const router: Router = Router();

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
  const [customer, vehicle, assignedTo] = await Promise.all([
    db.select().from(customersTable).where(eq(customersTable.id, order.customerId)).then(r => r[0]),
    db.select().from(vehiclesTable).where(eq(vehiclesTable.id, order.vehicleId)).then(r => r[0]),
    order.assignedToId ? db.select().from(employeesTable).where(eq(employeesTable.id, order.assignedToId)).then(r => r[0]) : Promise.resolve(null),
  ]);
  return { ...order, customer, vehicle, assignedTo };
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

  const enriched = await Promise.all(orders.map(enrichOrder));
  res.json({ data: enriched, total: Number(countResult.count), page, limit });
});

router.post("/", async (req, res) => {
  const [lastOrder] = await db.select({ orderNumber: repairOrdersTable.orderNumber }).from(repairOrdersTable).orderBy(desc(repairOrdersTable.id)).limit(1);
  const nextNum = lastOrder ? Number(lastOrder.orderNumber.replace("RO-", "")) + 1 : 1001;
  const orderNumber = `RO-${nextNum}`;

  const { customerId, vehicleId, assignedToId, status, priority, complaint, diagnosis, notes, estimatedHours, mileageIn, promisedDate } = req.body;
  const [order] = await db.insert(repairOrdersTable).values({
    orderNumber, customerId, vehicleId, assignedToId, status: status || "pending", priority: priority || "normal",
    complaint, diagnosis, notes, estimatedHours, mileageIn, promisedDate: promisedDate ? new Date(promisedDate) : null,
  }).returning();
  res.status(201).json(await enrichOrder(order));
});

router.get("/:id", async (req, res) => {
  const [order] = await db.select().from(repairOrdersTable).where(eq(repairOrdersTable.id, Number(req.params.id)));
  if (!order) return res.status(404).json({ error: "Repair order not found" });
  res.json(await enrichOrder(order));
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { orderNumber, vehicleId, assignedToId, status, priority, complaint, diagnosis, notes, parts, estimatedHours, actualHours, mileageIn, mileageOut, promisedDate, completedAt, createdAt } = req.body;

  // Fetch previous status to detect completion transition
  const [prev] = await db.select({ status: repairOrdersTable.status }).from(repairOrdersTable).where(eq(repairOrdersTable.id, id));

  // Build update payload — only include fields explicitly present in the body so we don't overwrite with undefined
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (orderNumber !== undefined) {
    const trimmed = String(orderNumber).trim();
    if (!trimmed) return res.status(400).json({ error: "Order number cannot be empty" });
    const [conflict] = await db
      .select({ id: repairOrdersTable.id })
      .from(repairOrdersTable)
      .where(and(eq(repairOrdersTable.orderNumber, trimmed), sql`${repairOrdersTable.id} <> ${id}`))
      .limit(1);
    if (conflict) return res.status(409).json({ error: `Order number ${trimmed} is already in use` });
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

  // Auto-set completedAt on transition to completed; allow explicit override
  if (completedAt !== undefined) {
    updates.completedAt = completedAt ? new Date(completedAt) : null;
  } else if (status === "completed" && prev?.status !== "completed") {
    updates.completedAt = new Date();
  }

  const [order] = await db.update(repairOrdersTable).set(updates).where(eq(repairOrdersTable.id, id)).returning();

  if (!order) return res.status(404).json({ error: "Repair order not found" });

  // Auto-create reminders when transitioning to completed
  if (status === "completed" && prev?.status !== "completed") {
    await autoCreateReminders(order).catch(() => {});
  }

  res.json(await enrichOrder(order));
});

router.delete("/:id", async (req, res) => {
  await db.delete(repairOrdersTable).where(eq(repairOrdersTable.id, Number(req.params.id)));
  res.status(204).send();
});

export default router;
