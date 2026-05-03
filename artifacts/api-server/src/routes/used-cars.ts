import { Router } from "express";
import { db } from "@workspace/db";
import {
  usedCarsTable,
  customersTable,
  purchaseLineItemsTable,
  purchasesTable,
  repairOrdersTable,
  shopSettingsTable,
} from "@workspace/db";
import { eq, sql, desc, and } from "drizzle-orm";

const router: Router = Router();

async function getLaborRate(): Promise<number> {
  const [s] = await db.select().from(shopSettingsTable).limit(1);
  return s ? Number(s.laborRate) : 95;
}

async function computeRecon(carId: number, laborRate: number) {
  // Parts/materials from purchase line items tagged to this car
  const partsRows = await db
    .select({
      id: purchaseLineItemsTable.id,
      purchaseId: purchaseLineItemsTable.purchaseId,
      description: purchaseLineItemsTable.description,
      quantity: purchaseLineItemsTable.quantity,
      unitCost: purchaseLineItemsTable.unitCost,
      itemType: purchaseLineItemsTable.itemType,
      purchaseDate: purchasesTable.purchaseDate,
      supplier: purchasesTable.supplier,
    })
    .from(purchaseLineItemsTable)
    .leftJoin(purchasesTable, eq(purchaseLineItemsTable.purchaseId, purchasesTable.id))
    .where(eq(purchaseLineItemsTable.usedCarId, carId));

  const partsTotal = partsRows.reduce(
    (sum, r) => sum + Number(r.quantity ?? 0) * Number(r.unitCost ?? 0),
    0
  );

  // Internal repair orders linked to this car
  const orders = await db
    .select()
    .from(repairOrdersTable)
    .where(and(eq(repairOrdersTable.usedCarId, carId), eq(repairOrdersTable.internal, true)))
    .orderBy(desc(repairOrdersTable.createdAt));

  let roPartsTotal = 0;
  let laborHours = 0;
  const orderSummaries = orders.map(o => {
    const partList = Array.isArray(o.parts) ? o.parts : [];
    const partsCost = partList.reduce(
      (s: number, p: any) => s + Number(p.quantity ?? 0) * Number(p.unitPrice ?? 0),
      0
    );
    const hours = Number(o.actualHours ?? o.estimatedHours ?? 0);
    roPartsTotal += partsCost;
    laborHours += hours;
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      complaint: o.complaint,
      diagnosis: o.diagnosis,
      hours,
      partsCost,
      laborCost: hours * laborRate,
      totalCost: partsCost + hours * laborRate,
      completedAt: o.completedAt,
      createdAt: o.createdAt,
    };
  });

  const laborTotal = laborHours * laborRate;
  const reconTotal = partsTotal + roPartsTotal + laborTotal;

  return {
    laborRate,
    partsFromPurchases: partsRows.map(r => ({
      ...r,
      quantity: Number(r.quantity),
      unitCost: Number(r.unitCost),
      lineTotal: Number(r.quantity) * Number(r.unitCost),
    })),
    partsFromPurchasesTotal: partsTotal,
    repairOrders: orderSummaries,
    repairOrderPartsTotal: roPartsTotal,
    laborHours,
    laborTotal,
    reconTotal,
  };
}

async function enrichCar(car: any, opts?: { withRecon?: boolean; laborRate?: number }) {
  const customer = car.customerId
    ? await db.select().from(customersTable).where(eq(customersTable.id, car.customerId)).then(r => r[0])
    : null;
  const base: any = { ...car, customer };
  if (opts?.withRecon) {
    const recon = await computeRecon(car.id, opts.laborRate ?? (await getLaborRate()));
    base.recon = recon;
    base.actualProfit =
      Number(car.sellingPrice) - Number(car.purchasePrice) - recon.reconTotal;
  }
  return base;
}

router.get("/", async (req, res) => {
  const status = req.query.status as string | undefined;
  const cars = status
    ? await db.select().from(usedCarsTable).where(eq(usedCarsTable.status, status)).orderBy(desc(usedCarsTable.createdAt))
    : await db.select().from(usedCarsTable).orderBy(desc(usedCarsTable.createdAt));

  const laborRate = await getLaborRate();

  // Per-car recon totals via aggregate query (purchase items + RO parts + labor hours)
  const reconRows = await db.execute(sql`
    SELECT
      c.id AS car_id,
      COALESCE(pli.parts_total, 0)::numeric AS purchase_parts,
      COALESCE(ro.ro_parts_total, 0)::numeric AS ro_parts,
      COALESCE(ro.total_hours, 0)::numeric AS hours
    FROM used_cars c
    LEFT JOIN (
      SELECT used_car_id, SUM(quantity::numeric * unit_cost::numeric) AS parts_total
      FROM purchase_line_items
      WHERE used_car_id IS NOT NULL
      GROUP BY used_car_id
    ) pli ON pli.used_car_id = c.id
    LEFT JOIN (
      SELECT used_car_id,
        SUM(COALESCE(actual_hours, estimated_hours, 0)::numeric) AS total_hours,
        SUM(COALESCE((
          SELECT SUM((p->>'quantity')::numeric * (p->>'unitPrice')::numeric)
          FROM jsonb_array_elements(COALESCE(parts, '[]'::jsonb)) p
        ), 0)) AS ro_parts_total
      FROM repair_orders
      WHERE internal = true AND used_car_id IS NOT NULL
      GROUP BY used_car_id
    ) ro ON ro.used_car_id = c.id
  `);
  const reconMap = new Map<number, number>();
  for (const r of reconRows.rows as any[]) {
    const total =
      Number(r.purchase_parts ?? 0) +
      Number(r.ro_parts ?? 0) +
      Number(r.hours ?? 0) * laborRate;
    reconMap.set(Number(r.car_id), total);
  }

  const enriched = await Promise.all(
    cars.map(async car => {
      const customer = car.customerId
        ? await db.select().from(customersTable).where(eq(customersTable.id, car.customerId)).then(r => r[0])
        : null;
      const reconTotal = reconMap.get(car.id) ?? 0;
      return {
        ...car,
        customer,
        reconTotal,
        actualProfit:
          Number(car.sellingPrice) - Number(car.purchasePrice) - reconTotal,
      };
    })
  );

  const [stats] = await db.select({
    totalAvailableValue: sql<number>`coalesce(sum(case when status = 'available' then selling_price else 0 end), 0)`,
    totalPurchasedCost: sql<number>`coalesce(sum(purchase_price), 0)`,
    soldProfit: sql<number>`coalesce(sum(case when status = 'sold' then (selling_price - purchase_price) else 0 end), 0)`,
    availableCount: sql<number>`sum(case when status = 'available' then 1 else 0 end)::int`,
    soldCount: sql<number>`sum(case when status = 'sold' then 1 else 0 end)::int`,
    reservedCount: sql<number>`sum(case when status = 'reserved' then 1 else 0 end)::int`,
  }).from(usedCarsTable);

  // Recon costs included in net sold profit
  const soldRecon = enriched
    .filter(c => c.status === "sold")
    .reduce((s, c) => s + c.reconTotal, 0);

  res.json({
    data: enriched,
    stats: {
      totalAvailableValue: Number(stats.totalAvailableValue),
      totalPurchasedCost: Number(stats.totalPurchasedCost),
      soldProfit: Number(stats.soldProfit),
      soldNetProfit: Number(stats.soldProfit) - soldRecon,
      soldReconTotal: soldRecon,
      availableCount: Number(stats.availableCount),
      soldCount: Number(stats.soldCount),
      reservedCount: Number(stats.reservedCount),
      laborRate,
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

router.get("/:id/recon", async (req, res) => {
  const id = Number(req.params.id);
  const [car] = await db.select().from(usedCarsTable).where(eq(usedCarsTable.id, id));
  if (!car) return res.status(404).json({ error: "Car not found" });
  const laborRate = await getLaborRate();
  const recon = await computeRecon(id, laborRate);
  const margin = Number(car.sellingPrice) - Number(car.purchasePrice);
  res.json({
    car,
    ...recon,
    grossMargin: margin,
    actualProfit: margin - recon.reconTotal,
  });
});

router.get("/:id", async (req, res) => {
  const [car] = await db.select().from(usedCarsTable).where(eq(usedCarsTable.id, Number(req.params.id)));
  if (!car) return res.status(404).json({ error: "Car not found" });
  res.json(await enrichCar(car, { withRecon: true }));
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
