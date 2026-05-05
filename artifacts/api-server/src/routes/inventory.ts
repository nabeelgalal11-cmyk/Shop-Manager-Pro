import { Router } from "express";
import { db } from "@workspace/db";
import { inventoryTable, stockMovementsTable, suppliersTable } from "@workspace/db";
import { eq, ilike, sql, desc } from "drizzle-orm";

const router: Router = Router();

router.get("/", async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const search = req.query.search as string | undefined;
  const category = req.query.category as string | undefined;
  const lowStock = req.query.lowStock === "true";
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

  if (search) {
    query = query.where(ilike(inventoryTable.name, `%${search}%`));
    countQuery = countQuery.where(ilike(inventoryTable.name, `%${search}%`));
  }
  if (category) {
    query = query.where(eq(inventoryTable.category, category));
    countQuery = countQuery.where(eq(inventoryTable.category, category));
  }

  const items = await query.orderBy(desc(inventoryTable.createdAt)).limit(limit).offset(offset);
  const [countResult] = await countQuery;
  const filtered = lowStock ? items.filter(i => i.quantity <= i.minQuantity) : items;
  res.json({ data: filtered, total: Number(countResult.count), page, limit });
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
