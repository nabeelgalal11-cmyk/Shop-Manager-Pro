import { Router } from "express";
import { db } from "@workspace/db";
import { timeEntriesTable, employeesTable } from "@workspace/db";
import { eq, sql, desc, and, gte, lte } from "drizzle-orm";

const router = Router();

router.get("/", async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 50;
  const employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;
  const startDate = req.query.startDate as string | undefined;
  const endDate = req.query.endDate as string | undefined;
  const offset = (page - 1) * limit;

  const conditions: any[] = [];
  if (employeeId) conditions.push(eq(timeEntriesTable.employeeId, employeeId));
  if (startDate) conditions.push(gte(timeEntriesTable.clockIn, new Date(startDate)));
  if (endDate) conditions.push(lte(timeEntriesTable.clockIn, new Date(endDate)));

  const entries = await (conditions.length
    ? db.select().from(timeEntriesTable).where(conditions.length === 1 ? conditions[0] : and(...conditions)).orderBy(desc(timeEntriesTable.clockIn)).limit(limit).offset(offset)
    : db.select().from(timeEntriesTable).orderBy(desc(timeEntriesTable.clockIn)).limit(limit).offset(offset));

  const [countResult] = await db.select({ count: sql<number>`count(*)` }).from(timeEntriesTable);

  const enriched = await Promise.all(entries.map(async (entry) => {
    const [employee] = await db.select().from(employeesTable).where(eq(employeesTable.id, entry.employeeId));
    return { ...entry, employee };
  }));

  res.json({ data: enriched, total: Number(countResult.count), page, limit });
});

export default router;
