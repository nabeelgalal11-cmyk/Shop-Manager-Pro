import { Router } from "express";
import { db } from "@workspace/db";
import { expensesTable } from "@workspace/db";
import { eq, sql, desc, and, gte, lte } from "drizzle-orm";

const router: Router = Router();

router.get("/", async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const category = req.query.category as string | undefined;
  const startDate = req.query.startDate as string | undefined;
  const endDate = req.query.endDate as string | undefined;
  const offset = (page - 1) * limit;

  const conditions: any[] = [];
  if (category) conditions.push(eq(expensesTable.category, category));
  if (startDate) conditions.push(gte(expensesTable.expenseDate, startDate));
  if (endDate) conditions.push(lte(expensesTable.expenseDate, endDate));

  const expenses = await (conditions.length
    ? db.select().from(expensesTable).where(conditions.length === 1 ? conditions[0] : and(...conditions)).orderBy(desc(expensesTable.expenseDate)).limit(limit).offset(offset)
    : db.select().from(expensesTable).orderBy(desc(expensesTable.expenseDate)).limit(limit).offset(offset));
  const [countResult] = await db.select({ count: sql<number>`count(*)` }).from(expensesTable);
  res.json({ data: expenses, total: Number(countResult.count), page, limit });
});

router.post("/", async (req, res) => {
  const { category, description, amount, vendor, receiptNumber, expenseDate, notes } = req.body;
  const [expense] = await db.insert(expensesTable).values({
    category, description, amount: amount.toString(), vendor, receiptNumber, expenseDate, notes,
  }).returning();
  res.status(201).json(expense);
});

router.get("/:id", async (req, res) => {
  const [expense] = await db.select().from(expensesTable).where(eq(expensesTable.id, Number(req.params.id)));
  if (!expense) return res.status(404).json({ error: "Expense not found" });
  res.json(expense);
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { category, description, amount, vendor, receiptNumber, expenseDate, notes } = req.body;
  const [expense] = await db.update(expensesTable).set({
    category, description, amount: amount?.toString(), vendor, receiptNumber, expenseDate, notes, updatedAt: new Date(),
  }).where(eq(expensesTable.id, id)).returning();
  if (!expense) return res.status(404).json({ error: "Expense not found" });
  res.json(expense);
});

router.delete("/:id", async (req, res) => {
  await db.delete(expensesTable).where(eq(expensesTable.id, Number(req.params.id)));
  res.status(204).send();
});

export default router;
