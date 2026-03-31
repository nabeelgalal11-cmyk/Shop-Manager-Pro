import { Router } from "express";
import { db } from "@workspace/db";
import { repairOrdersTable, customersTable, vehiclesTable, employeesTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";

const router = Router();

async function enrichOrder(order: any) {
  const [customer, vehicle, assignedTo] = await Promise.all([
    db.select().from(customersTable).where(eq(customersTable.id, order.customerId)).then(r => r[0]),
    db.select().from(vehiclesTable).where(eq(vehiclesTable.id, order.vehicleId)).then(r => r[0]),
    order.assignedToId ? db.select().from(employeesTable).where(eq(employeesTable.id, order.assignedToId)).then(r => r[0]) : Promise.resolve(null),
  ]);
  return { ...order, customer, vehicle, assignedTo };
}

router.get("/", async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const status = req.query.status as string | undefined;
  const offset = (page - 1) * limit;

  const orders = await (status
    ? db.select().from(repairOrdersTable).where(eq(repairOrdersTable.status, status)).orderBy(desc(repairOrdersTable.createdAt)).limit(limit).offset(offset)
    : db.select().from(repairOrdersTable).orderBy(desc(repairOrdersTable.createdAt)).limit(limit).offset(offset));

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
  const { assignedToId, status, priority, complaint, diagnosis, notes, parts, estimatedHours, actualHours, mileageIn, mileageOut, promisedDate, completedAt } = req.body;
  const [order] = await db.update(repairOrdersTable).set({
    assignedToId, status, priority, complaint, diagnosis, notes,
    parts: parts !== undefined ? parts : undefined,
    estimatedHours, actualHours,
    mileageIn, mileageOut,
    promisedDate: promisedDate ? new Date(promisedDate) : undefined,
    completedAt: completedAt ? new Date(completedAt) : undefined,
    updatedAt: new Date(),
  }).where(eq(repairOrdersTable.id, id)).returning();
  if (!order) return res.status(404).json({ error: "Repair order not found" });
  res.json(await enrichOrder(order));
});

router.delete("/:id", async (req, res) => {
  await db.delete(repairOrdersTable).where(eq(repairOrdersTable.id, Number(req.params.id)));
  res.status(204).send();
});

export default router;
