import { Router } from "express";
import { db } from "@workspace/db";
import { timeEntriesTable, employeesTable, repairOrdersTable } from "@workspace/db";
import { eq, sql, desc, and, gte, lte } from "drizzle-orm";
import { requirePermission } from "../lib/auth.js";

const router: Router = Router();

router.get("/", requirePermission("time_entries", "view"), async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 50;
  const employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;
  const repairOrderId = req.query.repairOrderId ? Number(req.query.repairOrderId) : undefined;
  const startDate = req.query.startDate as string | undefined;
  const endDate = req.query.endDate as string | undefined;
  const offset = (page - 1) * limit;

  const conditions: any[] = [];
  if (employeeId) conditions.push(eq(timeEntriesTable.employeeId, employeeId));
  if (repairOrderId) conditions.push(eq(timeEntriesTable.repairOrderId, repairOrderId));
  if (startDate) conditions.push(gte(timeEntriesTable.clockIn, new Date(startDate)));
  if (endDate) conditions.push(lte(timeEntriesTable.clockIn, new Date(endDate)));

  const entries = await (conditions.length
    ? db.select().from(timeEntriesTable).where(conditions.length === 1 ? conditions[0] : and(...conditions)).orderBy(desc(timeEntriesTable.clockIn)).limit(limit).offset(offset)
    : db.select().from(timeEntriesTable).orderBy(desc(timeEntriesTable.clockIn)).limit(limit).offset(offset));

  const [countResult] = await db.select({ count: sql<number>`count(*)` }).from(timeEntriesTable);

  const enriched = await Promise.all(entries.map(async (entry) => {
    const [employee] = await db.select().from(employeesTable).where(eq(employeesTable.id, entry.employeeId));
    const repairOrder = entry.repairOrderId
      ? await db.select().from(repairOrdersTable).where(eq(repairOrdersTable.id, entry.repairOrderId)).then(r => r[0])
      : null;
    return { ...entry, employee, repairOrder };
  }));

  res.json({ data: enriched, total: Number(countResult.count), page, limit });
});

export default router;
