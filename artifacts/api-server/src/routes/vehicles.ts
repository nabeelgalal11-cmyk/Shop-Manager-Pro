import { Router } from "express";
import { db } from "@workspace/db";
import { vehiclesTable, customersTable, repairOrdersTable, invoicesTable } from "@workspace/db";
import { eq, ilike, or, sql, desc } from "drizzle-orm";

const router: Router = Router();

router.get("/", async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const search = req.query.search as string | undefined;
  const customerId = req.query.customerId ? Number(req.query.customerId) : undefined;
  const offset = (page - 1) * limit;

  const conditions: any[] = [];
  if (customerId) conditions.push(eq(vehiclesTable.customerId, customerId));
  if (search) conditions.push(or(
    ilike(vehiclesTable.make, `%${search}%`),
    ilike(vehiclesTable.model, `%${search}%`),
    ilike(vehiclesTable.vin, `%${search}%`),
    ilike(vehiclesTable.licensePlate, `%${search}%`)
  ));

  const whereClause = conditions.length === 1 ? conditions[0] : conditions.length > 1 ? sql`${conditions[0]} AND ${conditions[1]}` : undefined;

  const vehicles = await db.select().from(vehiclesTable).where(whereClause).orderBy(desc(vehiclesTable.createdAt)).limit(limit).offset(offset);
  const [countResult] = await db.select({ count: sql<number>`count(*)` }).from(vehiclesTable).where(whereClause);

  const enriched = await Promise.all(vehicles.map(async (v) => {
    const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, v.customerId));
    return { ...v, customer };
  }));

  res.json({ data: enriched, total: Number(countResult.count), page, limit });
});

router.post("/", async (req, res) => {
  const { customerId, vin, licensePlate, year, make, model, trim, color, mileage, engineType, transmissionType, notes } = req.body;
  const [vehicle] = await db.insert(vehiclesTable).values({ customerId, vin, licensePlate, year, make, model, trim, color, mileage, engineType, transmissionType, notes }).returning();
  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, customerId));
  res.status(201).json({ ...vehicle, customer });
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, id));
  if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });
  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, vehicle.customerId));
  res.json({ ...vehicle, customer });
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { customerId, vin, licensePlate, year, make, model, trim, color, mileage, engineType, transmissionType, notes } = req.body;
  const [vehicle] = await db.update(vehiclesTable).set({ customerId, vin, licensePlate, year, make, model, trim, color, mileage, engineType, transmissionType, notes, updatedAt: new Date() }).where(eq(vehiclesTable.id, id)).returning();
  if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });
  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, vehicle.customerId));
  res.json({ ...vehicle, customer });
});

router.delete("/:id", async (req, res) => {
  await db.delete(vehiclesTable).where(eq(vehiclesTable.id, Number(req.params.id)));
  res.status(204).send();
});

router.get("/:id/service-history", async (req, res) => {
  const id = Number(req.params.id);
  const orders = await db.select().from(repairOrdersTable).where(eq(repairOrdersTable.vehicleId, id)).orderBy(desc(repairOrdersTable.createdAt));
  const history = orders.map((o) => ({
    id: o.id,
    vehicleId: o.vehicleId,
    date: o.createdAt.toISOString().split("T")[0],
    mileage: o.mileageIn,
    serviceType: o.complaint || "Service",
    description: o.diagnosis || o.notes || "",
    cost: 0,
    repairOrderId: o.id,
  }));
  res.json(history);
});

export default router;
