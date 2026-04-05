import { Router } from "express";
import { db } from "@workspace/db";
import { usedCarsTable, customersTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";

const router: Router = Router();

async function enrichCar(car: any) {
  const customer = car.customerId
    ? await db.select().from(customersTable).where(eq(customersTable.id, car.customerId)).then(r => r[0])
    : null;
  return { ...car, customer };
}

router.get("/", async (req, res) => {
  const status = req.query.status as string | undefined;
  const cars = status
    ? await db.select().from(usedCarsTable).where(eq(usedCarsTable.status, status)).orderBy(desc(usedCarsTable.createdAt))
    : await db.select().from(usedCarsTable).orderBy(desc(usedCarsTable.createdAt));

  const enriched = await Promise.all(cars.map(enrichCar));
  const [stats] = await db.select({
    totalAvailableValue: sql<number>`coalesce(sum(case when status = 'available' then selling_price else 0 end), 0)`,
    totalPurchasedCost: sql<number>`coalesce(sum(purchase_price), 0)`,
    soldProfit: sql<number>`coalesce(sum(case when status = 'sold' then (selling_price - purchase_price) else 0 end), 0)`,
    availableCount: sql<number>`sum(case when status = 'available' then 1 else 0 end)::int`,
    soldCount: sql<number>`sum(case when status = 'sold' then 1 else 0 end)::int`,
    reservedCount: sql<number>`sum(case when status = 'reserved' then 1 else 0 end)::int`,
  }).from(usedCarsTable);

  res.json({
    data: enriched,
    stats: {
      totalAvailableValue: Number(stats.totalAvailableValue),
      totalPurchasedCost: Number(stats.totalPurchasedCost),
      soldProfit: Number(stats.soldProfit),
      availableCount: Number(stats.availableCount),
      soldCount: Number(stats.soldCount),
      reservedCount: Number(stats.reservedCount),
    }
  });
});

router.post("/", async (req, res) => {
  const { vin, year, make, model, trim, color, mileage, condition, purchasePrice, sellingPrice, status, customerId, purchaseDate, saleDate, notes } = req.body;
  const [car] = await db.insert(usedCarsTable).values({
    vin, year, make, model, trim, color, mileage, condition,
    purchasePrice: String(purchasePrice),
    sellingPrice: String(sellingPrice),
    status: status || "available",
    customerId: customerId || null,
    purchaseDate, saleDate, notes,
  }).returning();
  res.status(201).json(await enrichCar(car));
});

router.get("/:id", async (req, res) => {
  const [car] = await db.select().from(usedCarsTable).where(eq(usedCarsTable.id, Number(req.params.id)));
  if (!car) return res.status(404).json({ error: "Car not found" });
  res.json(await enrichCar(car));
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { vin, year, make, model, trim, color, mileage, condition, purchasePrice, sellingPrice, status, customerId, purchaseDate, saleDate, notes } = req.body;
  const [car] = await db.update(usedCarsTable).set({
    vin, year, make, model, trim, color, mileage, condition,
    purchasePrice: String(purchasePrice),
    sellingPrice: String(sellingPrice),
    status, customerId: customerId || null,
    purchaseDate, saleDate, notes, updatedAt: new Date(),
  }).where(eq(usedCarsTable.id, id)).returning();
  if (!car) return res.status(404).json({ error: "Car not found" });
  res.json(await enrichCar(car));
});

router.delete("/:id", async (req, res) => {
  await db.delete(usedCarsTable).where(eq(usedCarsTable.id, Number(req.params.id)));
  res.status(204).send();
});

export default router;
