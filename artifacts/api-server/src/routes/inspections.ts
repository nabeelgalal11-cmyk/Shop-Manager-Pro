import { Router } from "express";
import { db } from "@workspace/db";
import { inspectionsTable, vehiclesTable, employeesTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";

const router: Router = Router();

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
    vehicleId, repairOrderId, inspectedById, type, mileage, overallCondition, items: items || [], notes,
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
    vehicleId, repairOrderId, inspectedById, type, mileage, overallCondition, items: items || [], notes, updatedAt: new Date(),
  }).where(eq(inspectionsTable.id, id)).returning();
  if (!inspection) return res.status(404).json({ error: "Inspection not found" });
  res.json(await enrichInspection(inspection));
});

export default router;
