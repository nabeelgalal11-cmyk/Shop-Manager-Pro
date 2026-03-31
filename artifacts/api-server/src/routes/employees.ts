import { Router } from "express";
import { db } from "@workspace/db";
import { employeesTable, timeEntriesTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";

const router = Router();

router.get("/", async (req, res) => {
  const role = req.query.role as string | undefined;
  const active = req.query.active !== undefined ? req.query.active === "true" : undefined;

  let query = db.select().from(employeesTable).$dynamic();
  const conditions: any[] = [];
  if (role) conditions.push(eq(employeesTable.role, role));
  if (active !== undefined) conditions.push(eq(employeesTable.active, active));

  const employees = await (conditions.length
    ? db.select().from(employeesTable).where(conditions[0]).orderBy(desc(employeesTable.createdAt))
    : db.select().from(employeesTable).orderBy(desc(employeesTable.createdAt)));

  res.json(employees);
});

router.post("/", async (req, res) => {
  const { firstName, lastName, email, phone, role, hourlyRate, active, hireDate, notes } = req.body;
  const [employee] = await db.insert(employeesTable).values({
    firstName, lastName, email, phone, role, hourlyRate, active: active ?? true, hireDate, notes,
  }).returning();
  res.status(201).json(employee);
});

router.get("/:id", async (req, res) => {
  const [employee] = await db.select().from(employeesTable).where(eq(employeesTable.id, Number(req.params.id)));
  if (!employee) return res.status(404).json({ error: "Employee not found" });
  res.json(employee);
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { firstName, lastName, email, phone, role, hourlyRate, active, hireDate, notes } = req.body;
  const [employee] = await db.update(employeesTable).set({ firstName, lastName, email, phone, role, hourlyRate, active, hireDate, notes, updatedAt: new Date() }).where(eq(employeesTable.id, id)).returning();
  if (!employee) return res.status(404).json({ error: "Employee not found" });
  res.json(employee);
});

router.delete("/:id", async (req, res) => {
  await db.delete(employeesTable).where(eq(employeesTable.id, Number(req.params.id)));
  res.status(204).send();
});

router.post("/:id/clock-in", async (req, res) => {
  const id = Number(req.params.id);
  await db.update(employeesTable).set({ clockedIn: true, updatedAt: new Date() }).where(eq(employeesTable.id, id));
  const [entry] = await db.insert(timeEntriesTable).values({ employeeId: id, clockIn: new Date() }).returning();
  res.status(201).json(entry);
});

router.post("/:id/clock-out", async (req, res) => {
  const id = Number(req.params.id);
  const clockOut = new Date();
  const openEntry = await db.select().from(timeEntriesTable).where(eq(timeEntriesTable.employeeId, id)).orderBy(desc(timeEntriesTable.clockIn)).limit(1);
  if (!openEntry[0]) return res.status(400).json({ error: "No open time entry" });
  const hours = (clockOut.getTime() - new Date(openEntry[0].clockIn).getTime()) / 3600000;
  const [entry] = await db.update(timeEntriesTable).set({ clockOut, totalHours: hours.toFixed(2) }).where(eq(timeEntriesTable.id, openEntry[0].id)).returning();
  await db.update(employeesTable).set({ clockedIn: false, updatedAt: new Date() }).where(eq(employeesTable.id, id));
  res.json(entry);
});

export default router;
