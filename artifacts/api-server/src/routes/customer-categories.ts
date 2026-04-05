import { Router } from "express";
import { db } from "@workspace/db";
import { customerCategoriesTable, customersTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";

const router: Router = Router();

router.get("/", async (_req, res) => {
  const categories = await db
    .select({
      id: customerCategoriesTable.id,
      name: customerCategoriesTable.name,
      description: customerCategoriesTable.description,
      laborRate: customerCategoriesTable.laborRate,
      partsMarkup: customerCategoriesTable.partsMarkup,
      createdAt: customerCategoriesTable.createdAt,
      updatedAt: customerCategoriesTable.updatedAt,
      customerCount: sql<number>`(select count(*) from customers where category_id = ${customerCategoriesTable.id})`,
    })
    .from(customerCategoriesTable)
    .orderBy(customerCategoriesTable.name);
  res.json(categories);
});

router.post("/", async (req, res) => {
  const { name, description, laborRate, partsMarkup } = req.body;
  const [category] = await db
    .insert(customerCategoriesTable)
    .values({ name, description, laborRate: String(laborRate ?? 120), partsMarkup: String(partsMarkup ?? 0) })
    .returning();
  res.status(201).json(category);
});

router.get("/:id", async (req, res) => {
  const [category] = await db
    .select()
    .from(customerCategoriesTable)
    .where(eq(customerCategoriesTable.id, Number(req.params.id)));
  if (!category) return res.status(404).json({ error: "Category not found" });
  res.json(category);
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name, description, laborRate, partsMarkup } = req.body;
  const [category] = await db
    .update(customerCategoriesTable)
    .set({ name, description, laborRate: String(laborRate), partsMarkup: String(partsMarkup), updatedAt: new Date() })
    .where(eq(customerCategoriesTable.id, id))
    .returning();
  if (!category) return res.status(404).json({ error: "Category not found" });
  res.json(category);
});

router.delete("/:id", async (req, res) => {
  await db.delete(customerCategoriesTable).where(eq(customerCategoriesTable.id, Number(req.params.id)));
  res.status(204).send();
});

export default router;
