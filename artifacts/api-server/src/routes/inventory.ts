import { Router } from "express";
import { db } from "@workspace/db";
import { inventoryTable, stockMovementsTable, suppliersTable } from "@workspace/db";
import { and, eq, ilike, sql, desc, or } from "drizzle-orm";
import { applyStockMovement } from "../lib/inventory.js";
import { getUser, requirePermission } from "../lib/auth.js";

const router: Router = Router();

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

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
  const {
    partNumber, name, description, category, vendor, preferredSupplierId,
    costPrice, sellPrice, quantity, minQuantity, location, notes, compatibleVehicles,
    defaultWarrantyMonths, defaultWarrantyMiles, openingStockDate,
  } = req.body;
  const initialQuantity = Number(quantity);
  const itemCost = Number(costPrice);
  if (!Number.isSafeInteger(initialQuantity) || initialQuantity < 0 || !Number.isFinite(itemCost) || itemCost < 0) {
    res.status(400).json({ error: "Opening quantity must be a non-negative whole number and cost must be zero or more." });
    return;
  }
  if (openingStockDate !== undefined && !isIsoDate(openingStockDate)) {
    res.status(400).json({ error: "Opening stock date must be a valid YYYY-MM-DD date." });
    return;
  }

  const item = await db.transaction(async (tx) => {
    const [created] = await tx.insert(inventoryTable).values({
      partNumber, name, description, category, vendor,
      preferredSupplierId: preferredSupplierId ? Number(preferredSupplierId) : null,
      costPrice: itemCost.toFixed(2), sellPrice: Number(sellPrice || 0).toFixed(2),
      quantity: 0, minQuantity, location, notes, compatibleVehicles,
      defaultWarrantyMonths: defaultWarrantyMonths === "" || defaultWarrantyMonths == null ? null : Number(defaultWarrantyMonths),
      defaultWarrantyMiles: defaultWarrantyMiles === "" || defaultWarrantyMiles == null ? null : Number(defaultWarrantyMiles),
    }).returning();

    if (initialQuantity > 0) {
      await applyStockMovement({
        inventoryId: created.id,
        delta: initialQuantity,
        reason: "opening_balance",
        referenceTable: "inventory",
        referenceId: created.id,
        unitCost: itemCost,
        ...(openingStockDate ? { effectiveDate: openingStockDate } : {}),
        notes: "Opening stock",
        createdById: getUser(req)?.id,
      }, tx);
    }

    const [saved] = await tx.select().from(inventoryTable).where(eq(inventoryTable.id, created.id));
    return saved;
  });
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
    .orderBy(desc(stockMovementsTable.effectiveDate), desc(stockMovementsTable.createdAt), desc(stockMovementsTable.id))
    .limit(limit);
  res.json({ data: movements.map(m => ({
    ...m,
    unitCost: m.unitCost != null ? Number(m.unitCost) : null,
  })) });
});

router.post("/:id/opening-stock", requirePermission("inventory", "edit"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const quantity = Number(req.body?.quantity);
  const unitCost = Number(req.body?.unitCost);
  const effectiveDate = req.body?.effectiveDate;
  const notes = typeof req.body?.notes === "string" ? req.body.notes.trim() : "";
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid inventory item ID." });
    return;
  }
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isFinite(unitCost) || unitCost < 0 || !isIsoDate(effectiveDate)) {
    res.status(400).json({ error: "Enter a whole-number quantity, a valid unit cost, and a valid effective date." });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [item] = await tx.select().from(inventoryTable)
      .where(eq(inventoryTable.id, id))
      .for("update");
    if (!item) return { kind: "missing" as const };
    const [existingMovement] = await tx.select({ id: stockMovementsTable.id })
      .from(stockMovementsTable)
      .where(eq(stockMovementsTable.inventoryId, id))
      .limit(1);
    if (Number(item.quantity) !== 0 || existingMovement) return { kind: "already-recorded" as const };

    await tx.update(inventoryTable)
      .set({ costPrice: unitCost.toFixed(2), updatedAt: new Date() })
      .where(eq(inventoryTable.id, id));
    const movement = await applyStockMovement({
      inventoryId: id,
      delta: quantity,
      reason: "opening_balance",
      referenceTable: "inventory",
      referenceId: id,
      unitCost,
      effectiveDate,
      notes: notes || "Opening stock",
      createdById: getUser(req)?.id,
    }, tx);
    return { kind: "created" as const, movement };
  });

  if (result.kind === "missing") {
    res.status(404).json({ error: "Inventory item not found." });
    return;
  }
  if (result.kind === "already-recorded" || !result.movement) {
    res.status(409).json({ error: "Opening stock has already been recorded for this item. Use a regular stock adjustment for later changes." });
    return;
  }
  res.status(201).json({
    ...result.movement,
    unitCost: result.movement.unitCost != null ? Number(result.movement.unitCost) : null,
  });
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { partNumber, name, description, category, vendor, preferredSupplierId, costPrice, sellPrice, quantity, minQuantity, location, notes, compatibleVehicles, defaultWarrantyMonths, defaultWarrantyMiles } = req.body;
  const targetQuantity = Number(quantity);
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(targetQuantity) || targetQuantity < 0) {
    res.status(400).json({ error: "Inventory quantity must be a non-negative whole number." });
    return;
  }

  const item = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(inventoryTable)
      .where(eq(inventoryTable.id, id))
      .for("update");
    if (!current) return null;

    const quantityDelta = targetQuantity - current.quantity;
    await tx.update(inventoryTable).set({
      partNumber, name, description, category, vendor,
      ...(preferredSupplierId !== undefined && {
        preferredSupplierId: preferredSupplierId === null || preferredSupplierId === ""
          ? null
          : Number(preferredSupplierId),
      }),
      costPrice: costPrice?.toString(), sellPrice: sellPrice?.toString(),
      minQuantity, location, notes, compatibleVehicles,
      ...(defaultWarrantyMonths !== undefined && { defaultWarrantyMonths: defaultWarrantyMonths === null || defaultWarrantyMonths === "" ? null : Number(defaultWarrantyMonths) }),
      ...(defaultWarrantyMiles !== undefined && { defaultWarrantyMiles: defaultWarrantyMiles === null || defaultWarrantyMiles === "" ? null : Number(defaultWarrantyMiles) }),
      updatedAt: new Date(),
    }).where(eq(inventoryTable.id, id));

    if (quantityDelta !== 0) {
      await applyStockMovement({
        inventoryId: id,
        delta: quantityDelta,
        reason: "manual_adjustment",
        referenceTable: "inventory",
        referenceId: id,
        unitCost: costPrice ?? current.costPrice,
        notes: "Inventory count adjusted from item details",
        createdById: getUser(req)?.id,
      }, tx);
    }

    const [saved] = await tx.select().from(inventoryTable).where(eq(inventoryTable.id, id));
    return saved ?? null;
  });
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  res.json(item);
});

router.delete("/:id", async (req, res) => {
  await db.delete(inventoryTable).where(eq(inventoryTable.id, Number(req.params.id)));
  res.status(204).send();
});

export default router;
