import { Router } from "express";
import { db } from "@workspace/db";
import { inventoryTable, stockMovementsTable, suppliersTable } from "@workspace/db";
import { and, eq, ilike, sql, desc, or } from "drizzle-orm";

const router: Router = Router();

function vehicleMatchesFitment(
  compatibleVehicles: string | null | undefined,
  year: number,
  make: string,
  model: string,
): boolean {
  const fitment = compatibleVehicles?.trim().toLowerCase();
  if (!fitment) return true;

  const normalized = fitment.replace(/[–—]/g, "-");
  if (!normalized.includes(make.toLowerCase()) || !normalized.includes(model.toLowerCase())) return false;

  const rangeMatches = [...normalized.matchAll(/\b((?:19|20)\d{2})\s*-\s*(\d{2,4})\b/g)];
  const plusMatches = [...normalized.matchAll(/\b((?:19|20)\d{2})\s*\+/g)];
  const explicitYears = [...normalized.matchAll(/\b(?:19|20)\d{2}\b/g)].map((match) => Number(match[0]));

  if (rangeMatches.some((match) => {
    const start = Number(match[1]);
    const rawEnd = match[2];
    const end = rawEnd.length === 2 ? Math.floor(start / 100) * 100 + Number(rawEnd) : Number(rawEnd);
    return year >= start && year <= end;
  })) return true;

  if (plusMatches.some((match) => year >= Number(match[1]))) return true;
  if (explicitYears.length === 0) return true;
  return explicitYears.includes(year);
}

router.get("/", async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const search = req.query.search as string | undefined;
  const category = req.query.category as string | undefined;
  const lowStock = req.query.lowStock === "true";
  const vehicleYear = Number(req.query.vehicleYear);
  const vehicleMake = String(req.query.vehicleMake ?? "").trim();
  const vehicleModel = String(req.query.vehicleModel ?? "").trim();
  const hasVehicleFitment = Number.isInteger(vehicleYear) && vehicleYear > 0 && Boolean(vehicleMake && vehicleModel);
  const offset = (page - 1) * limit;

  let query = db
    .select({
      id: inventoryTable.id,
      partNumber: inventoryTable.partNumber,
      name: inventoryTable.name,
      description: inventoryTable.description,
      category: inventoryTable.category,
      vendor: inventoryTable.vendor,
      preferredSupplierId: inventoryTable.preferredSupplierId,
      preferredSupplierName: suppliersTable.name,
      costPrice: inventoryTable.costPrice,
      sellPrice: inventoryTable.sellPrice,
      quantity: inventoryTable.quantity,
      minQuantity: inventoryTable.minQuantity,
      location: inventoryTable.location,
      notes: inventoryTable.notes,
      compatibleVehicles: inventoryTable.compatibleVehicles,
      defaultWarrantyMonths: inventoryTable.defaultWarrantyMonths,
      defaultWarrantyMiles: inventoryTable.defaultWarrantyMiles,
      createdAt: inventoryTable.createdAt,
      updatedAt: inventoryTable.updatedAt,
    })
    .from(inventoryTable)
    .leftJoin(suppliersTable, eq(suppliersTable.id, inventoryTable.preferredSupplierId))
    .$dynamic();
  let countQuery = db.select({ count: sql<number>`count(*)` }).from(inventoryTable).$dynamic();

  const filters = [];
  if (search) {
    filters.push(or(
      ilike(inventoryTable.name, `%${search}%`),
      ilike(inventoryTable.partNumber, `%${search}%`),
      ilike(inventoryTable.category, `%${search}%`),
    ));
  }
  if (category) {
    filters.push(eq(inventoryTable.category, category));
  }
  if (hasVehicleFitment) {
    filters.push(or(
      sql`${inventoryTable.compatibleVehicles} IS NULL`,
      sql`btrim(${inventoryTable.compatibleVehicles}) = ''`,
      and(
        ilike(inventoryTable.compatibleVehicles, `%${vehicleMake}%`),
        ilike(inventoryTable.compatibleVehicles, `%${vehicleModel}%`),
      ),
    ));
  }
  if (filters.length) {
    const filter = and(...filters);
    query = query.where(filter);
    countQuery = countQuery.where(filter);
  }

  const items = hasVehicleFitment
    ? await query.orderBy(desc(inventoryTable.createdAt))
    : await query.orderBy(desc(inventoryTable.createdAt)).limit(limit).offset(offset);
  const [countResult] = await countQuery;
  const fitmentFiltered = hasVehicleFitment
    ? items.filter((item) => vehicleMatchesFitment(item.compatibleVehicles, vehicleYear, vehicleMake, vehicleModel))
    : items;
  const stockFiltered = lowStock ? fitmentFiltered.filter(i => i.quantity <= i.minQuantity) : fitmentFiltered;
  const data = hasVehicleFitment ? stockFiltered.slice(offset, offset + limit) : stockFiltered;
  res.json({ data, total: hasVehicleFitment ? stockFiltered.length : Number(countResult.count), page, limit });
});

router.post("/", async (req, res) => {
  const { partNumber, name, description, category, vendor, preferredSupplierId, costPrice, sellPrice, quantity, minQuantity, location, notes, compatibleVehicles, defaultWarrantyMonths, defaultWarrantyMiles } = req.body;
  const [item] = await db.insert(inventoryTable).values({
    partNumber, name, description, category, vendor,
    preferredSupplierId: preferredSupplierId ? Number(preferredSupplierId) : null,
    costPrice: costPrice.toString(), sellPrice: sellPrice.toString(),
    quantity, minQuantity, location, notes, compatibleVehicles,
    defaultWarrantyMonths: defaultWarrantyMonths === "" || defaultWarrantyMonths == null ? null : Number(defaultWarrantyMonths),
    defaultWarrantyMiles: defaultWarrantyMiles === "" || defaultWarrantyMiles == null ? null : Number(defaultWarrantyMiles),
  }).returning();
  res.status(201).json(item);
});

router.get("/:id", async (req, res) => {
  const [item] = await db
    .select({
      id: inventoryTable.id,
      partNumber: inventoryTable.partNumber,
      name: inventoryTable.name,
      description: inventoryTable.description,
      category: inventoryTable.category,
      vendor: inventoryTable.vendor,
      preferredSupplierId: inventoryTable.preferredSupplierId,
      preferredSupplierName: suppliersTable.name,
      costPrice: inventoryTable.costPrice,
      sellPrice: inventoryTable.sellPrice,
      quantity: inventoryTable.quantity,
      minQuantity: inventoryTable.minQuantity,
      location: inventoryTable.location,
      notes: inventoryTable.notes,
      compatibleVehicles: inventoryTable.compatibleVehicles,
      defaultWarrantyMonths: inventoryTable.defaultWarrantyMonths,
      defaultWarrantyMiles: inventoryTable.defaultWarrantyMiles,
      createdAt: inventoryTable.createdAt,
      updatedAt: inventoryTable.updatedAt,
    })
    .from(inventoryTable)
    .leftJoin(suppliersTable, eq(suppliersTable.id, inventoryTable.preferredSupplierId))
    .where(eq(inventoryTable.id, Number(req.params.id)));
  if (!item) return res.status(404).json({ error: "Item not found" });
  res.json(item);
});

// GET /api/inventory/:id/movements — recent stock movement history
router.get("/:id/movements", async (req, res) => {
  const id = Number(req.params.id);
  const limit = Math.min(200, Number(req.query.limit) || 20);
  const movements = await db.select().from(stockMovementsTable)
    .where(eq(stockMovementsTable.inventoryId, id))
    .orderBy(desc(stockMovementsTable.createdAt), desc(stockMovementsTable.id))
    .limit(limit);
  res.json({ data: movements.map(m => ({
    ...m,
    unitCost: m.unitCost != null ? Number(m.unitCost) : null,
  })) });
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { partNumber, name, description, category, vendor, preferredSupplierId, costPrice, sellPrice, quantity, minQuantity, location, notes, compatibleVehicles, defaultWarrantyMonths, defaultWarrantyMiles } = req.body;
  const [item] = await db.update(inventoryTable).set({
    partNumber, name, description, category, vendor,
    ...(preferredSupplierId !== undefined && {
      preferredSupplierId: preferredSupplierId === null || preferredSupplierId === ""
        ? null
        : Number(preferredSupplierId),
    }),
    costPrice: costPrice?.toString(), sellPrice: sellPrice?.toString(),
    quantity, minQuantity, location, notes, compatibleVehicles,
    ...(defaultWarrantyMonths !== undefined && { defaultWarrantyMonths: defaultWarrantyMonths === null || defaultWarrantyMonths === "" ? null : Number(defaultWarrantyMonths) }),
    ...(defaultWarrantyMiles !== undefined && { defaultWarrantyMiles: defaultWarrantyMiles === null || defaultWarrantyMiles === "" ? null : Number(defaultWarrantyMiles) }),
    updatedAt: new Date(),
  }).where(eq(inventoryTable.id, id)).returning();
  if (!item) return res.status(404).json({ error: "Item not found" });
  res.json(item);
});

router.delete("/:id", async (req, res) => {
  await db.delete(inventoryTable).where(eq(inventoryTable.id, Number(req.params.id)));
  res.status(204).send();
});

export default router;
