import { Router } from "express";
import { db } from "@workspace/db";
import { inventoryTable } from "@workspace/db";
import { eq, ilike, sql, desc, lte } from "drizzle-orm";

const router: Router = Router();

router.get("/", async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const search = req.query.search as string | undefined;
  const category = req.query.category as string | undefined;
  const lowStock = req.query.lowStock === "true";
  const offset = (page - 1) * limit;

  let query = db.select().from(inventoryTable).$dynamic();
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
  const { partNumber, name, description, category, vendor, costPrice, sellPrice, quantity, minQuantity, location, notes, compatibleVehicles } = req.body;
  const [item] = await db.insert(inventoryTable).values({
    partNumber, name, description, category, vendor,
    costPrice: costPrice.toString(), sellPrice: sellPrice.toString(),
    quantity, minQuantity, location, notes, compatibleVehicles,
  }).returning();
  res.status(201).json(item);
});

router.get("/:id", async (req, res) => {
  const [item] = await db.select().from(inventoryTable).where(eq(inventoryTable.id, Number(req.params.id)));
  if (!item) return res.status(404).json({ error: "Item not found" });
  res.json(item);
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { partNumber, name, description, category, vendor, costPrice, sellPrice, quantity, minQuantity, location, notes, compatibleVehicles } = req.body;
  const [item] = await db.update(inventoryTable).set({
    partNumber, name, description, category, vendor,
    costPrice: costPrice?.toString(), sellPrice: sellPrice?.toString(),
    quantity, minQuantity, location, notes, compatibleVehicles, updatedAt: new Date(),
  }).where(eq(inventoryTable.id, id)).returning();
  if (!item) return res.status(404).json({ error: "Item not found" });
  res.json(item);
});

router.delete("/:id", async (req, res) => {
  await db.delete(inventoryTable).where(eq(inventoryTable.id, Number(req.params.id)));
  res.status(204).send();
});

export default router;
