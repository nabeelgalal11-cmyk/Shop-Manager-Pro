import { Router } from "express";
import { db } from "@workspace/db";
import {
  usedCarsTable,
  customersTable,
  invoicesTable,
  purchaseLineItemsTable,
  purchasesTable,
  repairOrdersTable,
  shopSettingsTable,
  timeEntriesTable,
  employeesTable,
} from "@workspace/db";
import { eq, sql, desc, and, inArray } from "drizzle-orm";
import { requirePermission } from "../lib/auth.js";

const router: Router = Router();

async function getLaborRate(): Promise<number> {
  const [s] = await db.select().from(shopSettingsTable).limit(1);
  return s ? Number(s.laborRate) : 95;
}

async function computeRecon(carId: number, defaultLaborRate: number) {
  // 1) Parts/materials from purchase line items tagged to this car
  const partsRows = await db
    .select({
      id: purchaseLineItemsTable.id,
      purchaseId: purchaseLineItemsTable.purchaseId,
      description: purchaseLineItemsTable.description,
      quantity: purchaseLineItemsTable.quantity,
      unitCost: purchaseLineItemsTable.unitCost,
      itemType: purchaseLineItemsTable.itemType,
      purchaseDate: purchasesTable.purchaseDate,
      supplier: purchasesTable.supplierLegacy,
    })
    .from(purchaseLineItemsTable)
    .leftJoin(purchasesTable, eq(purchaseLineItemsTable.purchaseId, purchasesTable.id))
    .where(eq(purchaseLineItemsTable.usedCarId, carId));

  const partsTotal = partsRows.reduce(
    (sum, r) => sum + Number(r.quantity ?? 0) * Number(r.unitCost ?? 0),
    0
  );

  // 2) Internal repair orders for this car
  const orders = await db
    .select()
    .from(repairOrdersTable)
    .where(and(eq(repairOrdersTable.usedCarId, carId), eq(repairOrdersTable.internal, true)))
    .orderBy(desc(repairOrdersTable.createdAt));
  const orderIds = orders.map(o => o.id);

  // 3) Time entries linked to those ROs (with employee hourly rate)
  const timeRows = orderIds.length
    ? await db
        .select({
          id: timeEntriesTable.id,
          repairOrderId: timeEntriesTable.repairOrderId,
          totalHours: timeEntriesTable.totalHours,
          clockIn: timeEntriesTable.clockIn,
          clockOut: timeEntriesTable.clockOut,
          employeeId: timeEntriesTable.employeeId,
          employeeFirstName: employeesTable.firstName,
          employeeLastName: employeesTable.lastName,
          hourlyRate: employeesTable.hourlyRate,
        })
        .from(timeEntriesTable)
        .leftJoin(employeesTable, eq(timeEntriesTable.employeeId, employeesTable.id))
        .where(inArray(timeEntriesTable.repairOrderId, orderIds))
    : [];

  // Aggregate labor cost per RO from time entries; fallback to RO actual/estimated hours × shop rate when no entries
  const laborByOrder = new Map<number, { hours: number; cost: number; entries: typeof timeRows }>();
  for (const t of timeRows) {
    const id = t.repairOrderId!;
    const hours = Number(t.totalHours ?? 0);
    const rate = t.hourlyRate ? Number(t.hourlyRate) : defaultLaborRate;
    const bucket = laborByOrder.get(id) ?? { hours: 0, cost: 0, entries: [] as typeof timeRows };
    bucket.hours += hours;
    bucket.cost += hours * rate;
    bucket.entries.push(t);
    laborByOrder.set(id, bucket);
  }

  let roPartsTotal = 0;
  let laborHours = 0;
  let laborTotal = 0;
  const orderSummaries = orders.map(o => {
    const partList = Array.isArray(o.parts) ? o.parts : [];
    const partsCost = partList.reduce(
      (s: number, p: any) => s + Number(p.quantity ?? 0) * Number(p.unitPrice ?? 0),
      0
    );
    const labor = laborByOrder.get(o.id);
    let hours: number;
    let laborCost: number;
    let laborSource: "time_entries" | "ro_hours_fallback";
    if (labor && labor.hours > 0) {
      hours = labor.hours;
      laborCost = labor.cost;
      laborSource = "time_entries";
    } else {
      hours = Number(o.actualHours ?? o.estimatedHours ?? 0);
      laborCost = hours * defaultLaborRate;
      laborSource = "ro_hours_fallback";
    }
    roPartsTotal += partsCost;
    laborHours += hours;
    laborTotal += laborCost;
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      complaint: o.complaint,
      diagnosis: o.diagnosis,
      hours,
      partsCost,
      laborCost,
      laborSource,
      totalCost: partsCost + laborCost,
      completedAt: o.completedAt,
      createdAt: o.createdAt,
    };
  });

  const reconTotal = partsTotal + roPartsTotal + laborTotal;

  return {
    laborRate: defaultLaborRate,
    partsFromPurchases: partsRows.map(r => ({
      ...r,
      quantity: Number(r.quantity),
      unitCost: Number(r.unitCost),
      lineTotal: Number(r.quantity) * Number(r.unitCost),
    })),
    partsFromPurchasesTotal: partsTotal,
    repairOrders: orderSummaries,
    repairOrderPartsTotal: roPartsTotal,
    timeEntries: timeRows.map(t => ({
      ...t,
      totalHours: Number(t.totalHours ?? 0),
      hourlyRate: t.hourlyRate ? Number(t.hourlyRate) : null,
      cost: Number(t.totalHours ?? 0) * (t.hourlyRate ? Number(t.hourlyRate) : defaultLaborRate),
    })),
    laborHours,
    laborTotal,
    reconTotal,
  };
}

async function enrichCar(car: any, opts?: { withRecon?: boolean; laborRate?: number }) {
  const [customer, buyer, saleInvoice] = await Promise.all([
    car.customerId
      ? db.select().from(customersTable).where(eq(customersTable.id, car.customerId)).then(r => r[0] ?? null)
      : Promise.resolve(null),
    car.buyerId
      ? db.select().from(customersTable).where(eq(customersTable.id, car.buyerId)).then(r => r[0] ?? null)
      : Promise.resolve(null),
    car.saleInvoiceId
      ? db.select({ id: invoicesTable.id, invoiceNumber: invoicesTable.invoiceNumber, total: invoicesTable.total, status: invoicesTable.status })
          .from(invoicesTable).where(eq(invoicesTable.id, car.saleInvoiceId)).then(r => r[0] ?? null)
      : Promise.resolve(null),
  ]);
  const base: any = { ...car, customer, buyer, saleInvoice };
  if (opts?.withRecon) {
    const rate = opts.laborRate ?? (await getLaborRate());
    const recon = await computeRecon(car.id, rate);
    const hasSellingPrice = car.sellingPrice != null && car.sellingPrice !== "";
    const sellingPrice = hasSellingPrice ? Number(car.sellingPrice) : null;
    const purchasePrice = Number(car.purchasePrice);
    const totalCost = purchasePrice + recon.reconTotal;
    const actualProfit = sellingPrice != null ? sellingPrice - totalCost : null;
    const marginPct = sellingPrice != null && sellingPrice > 0 && actualProfit != null
      ? (actualProfit / sellingPrice) * 100
      : null;
    base.recon = recon;
    base.reconTotal = recon.reconTotal;
    base.totalCost = totalCost;
    base.actualProfit = actualProfit;
    base.marginPct = marginPct != null ? Math.round(marginPct * 10) / 10 : null;
  }
  return base;
}

router.get("/", requirePermission("used_cars", "view"), async (req, res) => {
  const status = req.query.status as string | undefined;
  const cars = status
    ? await db.select().from(usedCarsTable).where(eq(usedCarsTable.status, status)).orderBy(desc(usedCarsTable.createdAt))
    : await db.select().from(usedCarsTable).orderBy(desc(usedCarsTable.createdAt));

  const laborRate = await getLaborRate();

  // Per-car recon totals (purchase parts + RO parts + labor from time_entries; fallback to RO hours × shop rate when no entries)
  const reconRows = await db.execute(sql`
    SELECT
      c.id AS car_id,
      COALESCE(pli.parts_total, 0)::numeric AS purchase_parts,
      COALESCE(ro_parts.total, 0)::numeric AS ro_parts,
      COALESCE(labor.total, 0)::numeric AS labor_cost
    FROM used_cars c
    LEFT JOIN (
      SELECT used_car_id, SUM(quantity::numeric * unit_cost::numeric) AS parts_total
      FROM purchase_line_items WHERE used_car_id IS NOT NULL
      GROUP BY used_car_id
    ) pli ON pli.used_car_id = c.id
    LEFT JOIN (
      SELECT ro.used_car_id, SUM(COALESCE((
        SELECT SUM((p->>'quantity')::numeric * (p->>'unitPrice')::numeric)
        FROM jsonb_array_elements(COALESCE(ro.parts, '[]'::jsonb)) p
      ), 0)) AS total
      FROM repair_orders ro
      WHERE ro.internal = true AND ro.used_car_id IS NOT NULL
      GROUP BY ro.used_car_id
    ) ro_parts ON ro_parts.used_car_id = c.id
    LEFT JOIN (
      SELECT ro.used_car_id,
        SUM(
          CASE
            WHEN te.has_entries THEN te.cost
            ELSE COALESCE(ro.actual_hours, ro.estimated_hours, 0)::numeric * ${laborRate}
          END
        ) AS total
      FROM repair_orders ro
      LEFT JOIN (
        SELECT
          repair_order_id,
          true AS has_entries,
          SUM(COALESCE(total_hours, 0)::numeric * COALESCE(e.hourly_rate, ${laborRate})::numeric) AS cost
        FROM time_entries t
        LEFT JOIN employees e ON e.id = t.employee_id
        WHERE repair_order_id IS NOT NULL
        GROUP BY repair_order_id
      ) te ON te.repair_order_id = ro.id
      WHERE ro.internal = true AND ro.used_car_id IS NOT NULL
      GROUP BY ro.used_car_id
    ) labor ON labor.used_car_id = c.id
  `);
  type ReconRow = { car_id: number | string; purchase_parts: number | string | null; ro_parts: number | string | null; labor_cost: number | string | null };
  const reconMap = new Map<number, number>();
  for (const r of reconRows.rows as ReconRow[]) {
    const total = Number(r.purchase_parts ?? 0) + Number(r.ro_parts ?? 0) + Number(r.labor_cost ?? 0);
    reconMap.set(Number(r.car_id), total);
  }

  const enriched = await Promise.all(
    cars.map(async car => {
      const [customer, buyer, saleInvoice] = await Promise.all([
        car.customerId
          ? db.select().from(customersTable).where(eq(customersTable.id, car.customerId)).then(r => r[0] ?? null)
          : Promise.resolve(null),
        car.buyerId
          ? db.select().from(customersTable).where(eq(customersTable.id, car.buyerId)).then(r => r[0] ?? null)
          : Promise.resolve(null),
        car.saleInvoiceId
          ? db.select({ id: invoicesTable.id, invoiceNumber: invoicesTable.invoiceNumber, total: invoicesTable.total, status: invoicesTable.status })
              .from(invoicesTable).where(eq(invoicesTable.id, car.saleInvoiceId)).then(r => r[0] ?? null)
          : Promise.resolve(null),
      ]);
      const reconTotal = reconMap.get(car.id) ?? 0;
      const hasSellingPrice = car.sellingPrice != null && car.sellingPrice !== "";
      const sellingPrice = hasSellingPrice ? Number(car.sellingPrice) : null;
      const purchasePrice = Number(car.purchasePrice);
      const actualProfit = sellingPrice != null ? sellingPrice - purchasePrice - reconTotal : null;
      const marginPct = sellingPrice != null && sellingPrice > 0 && actualProfit != null
        ? Math.round((actualProfit / sellingPrice) * 1000) / 10
        : null;
      return { ...car, customer, buyer, saleInvoice, reconTotal, actualProfit, marginPct };
    })
  );

  const [stats] = await db.select({
    totalAvailableValue: sql<number>`coalesce(sum(case when status = 'available' then selling_price else 0 end), 0)`,
    totalPurchasedCost: sql<number>`coalesce(sum(purchase_price), 0)`,
    soldProfit: sql<number>`coalesce(sum(case when status = 'sold' then (selling_price - purchase_price) else 0 end), 0)`,
    availableCount: sql<number>`sum(case when status = 'available' then 1 else 0 end)::int`,
    soldCount: sql<number>`sum(case when status = 'sold' then 1 else 0 end)::int`,
    reservedCount: sql<number>`sum(case when status = 'reserved' then 1 else 0 end)::int`,
    needsWorkCount: sql<number>`sum(case when status = 'needs_work' then 1 else 0 end)::int`,
  }).from(usedCarsTable);

  const soldRecon = (enriched as any[]).filter((c: any) => c.status === "sold").reduce((s: number, c: any) => s + c.reconTotal, 0);

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
      needsWorkCount: Number(stats.needsWorkCount),
      laborRate,
    }
  });
});

router.post("/", requirePermission("used_cars", "create"), async (req, res) => {
  const { vin, year, make, model, trim, color, mileage, engineType, transmissionType, condition, purchasePrice, sellingPrice, status, customerId, buyerId, saleInvoiceId, purchaseDate, saleDate, notes } = req.body;
  const sellingPriceValue = sellingPrice == null || sellingPrice === "" ? null : String(sellingPrice);
  const [car] = await db.insert(usedCarsTable).values({
    vin, year, make, model, trim, color, mileage, engineType, transmissionType, condition,
    purchasePrice: String(purchasePrice),
    sellingPrice: sellingPriceValue,
    status: status || "needs_work",
    customerId: customerId || null,
    buyerId: buyerId || null,
    saleInvoiceId: saleInvoiceId || null,
    purchaseDate, saleDate, notes,
  }).returning();
  res.status(201).json(await enrichCar(car));
});

router.get("/:id/recon", requirePermission("used_cars", "view"), async (req, res) => {
  const id = Number(req.params.id);
  const [car] = await db.select().from(usedCarsTable).where(eq(usedCarsTable.id, id));
  if (!car) return res.status(404).json({ error: "Car not found" });
  const laborRate = await getLaborRate();
  const recon = await computeRecon(id, laborRate);
  const hasSellingPrice = car.sellingPrice != null && car.sellingPrice !== "";
  const sellingPrice = hasSellingPrice ? Number(car.sellingPrice) : null;
  const purchasePrice = Number(car.purchasePrice);
  const grossMargin = sellingPrice != null ? sellingPrice - purchasePrice : null;
  const actualProfit = grossMargin != null ? grossMargin - recon.reconTotal : null;
  const marginPct = sellingPrice != null && sellingPrice > 0 && actualProfit != null
    ? Math.round((actualProfit / sellingPrice) * 1000) / 10
    : null;
  res.json({
    car,
    ...recon,
    grossMargin,
    actualProfit,
    marginPct,
  });
});

router.get("/:id", requirePermission("used_cars", "view"), async (req, res) => {
  const [car] = await db.select().from(usedCarsTable).where(eq(usedCarsTable.id, Number(req.params.id)));
  if (!car) return res.status(404).json({ error: "Car not found" });
  res.json(await enrichCar(car, { withRecon: true }));
});

router.put("/:id", requirePermission("used_cars", "edit"), async (req, res) => {
  const id = Number(req.params.id);
  const { vin, year, make, model, trim, color, mileage, engineType, transmissionType, condition, purchasePrice, sellingPrice, status, customerId, buyerId, saleInvoiceId, purchaseDate, saleDate, notes } = req.body;
  const sellingPriceValue = sellingPrice == null || sellingPrice === "" ? null : String(sellingPrice);
  const [car] = await db.update(usedCarsTable).set({
    vin, year, make, model, trim, color, mileage, engineType, transmissionType, condition,
    purchasePrice: String(purchasePrice),
    sellingPrice: sellingPriceValue,
    status, customerId: customerId || null,
    buyerId: buyerId || null,
    saleInvoiceId: saleInvoiceId || null,
    purchaseDate, saleDate, notes, updatedAt: new Date(),
  }).where(eq(usedCarsTable.id, id)).returning();
  if (!car) return res.status(404).json({ error: "Car not found" });
  res.json(await enrichCar(car));
});

router.delete("/:id", requirePermission("used_cars", "delete"), async (req, res) => {
  await db.delete(usedCarsTable).where(eq(usedCarsTable.id, Number(req.params.id)));
  res.status(204).send();
});

export default router;
