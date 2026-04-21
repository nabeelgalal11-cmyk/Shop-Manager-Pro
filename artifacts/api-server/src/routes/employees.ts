import { Router } from "express";
import { db } from "@workspace/db";
import { employeesTable, timeEntriesTable } from "@workspace/db";
import { eq, sql, desc, and, or } from "drizzle-orm";

const router: Router = Router();

router.get("/", async (req, res) => {
  const role = req.query.role as string | undefined;
  const active = req.query.active !== undefined ? req.query.active === "true" : undefined;

  const conditions: any[] = [];
  if (role) {
    conditions.push(
      or(
        sql`${role} = ANY(${employeesTable.roles})`,
        and(
          sql`coalesce(array_length(${employeesTable.roles}, 1), 0) = 0`,
          eq(employeesTable.role, role),
        ),
      ),
    );
  }
  if (active !== undefined) conditions.push(eq(employeesTable.active, active));

  const where =
    conditions.length === 0
      ? undefined
      : conditions.length === 1
        ? conditions[0]
        : and(...conditions);

  const employees = await (where
    ? db.select().from(employeesTable).where(where).orderBy(desc(employeesTable.createdAt))
    : db.select().from(employeesTable).orderBy(desc(employeesTable.createdAt)));

  res.json(employees);
});

router.post("/", async (req, res) => {
  const { firstName, lastName, email, phone, role, roles, hourlyRate, active, hireDate, notes } = req.body;
  const rolesArr: string[] = Array.isArray(roles) && roles.length > 0
    ? roles
    : (role ? [role] : []);
  const primaryRole: string = role || rolesArr[0] || "technician";
  const [employee] = await db.insert(employeesTable).values({
    firstName, lastName, email, phone,
    role: primaryRole,
    roles: rolesArr,
    hourlyRate, active: active ?? true, hireDate, notes,
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
  const { firstName, lastName, email, phone, role, roles, hourlyRate, active, hireDate, notes } = req.body;
  const updates: any = { updatedAt: new Date() };
  if (firstName !== undefined) updates.firstName = firstName;
  if (lastName !== undefined) updates.lastName = lastName;
  if (email !== undefined) updates.email = email;
  if (phone !== undefined) updates.phone = phone;
  if (hourlyRate !== undefined) updates.hourlyRate = hourlyRate;
  if (active !== undefined) updates.active = active;
  if (hireDate !== undefined) updates.hireDate = hireDate;
  if (notes !== undefined) updates.notes = notes;
  if (Array.isArray(roles)) {
    updates.roles = roles;
    if (!role && roles.length > 0) updates.role = roles[0];
  }
  if (role !== undefined) updates.role = role;
  const [employee] = await db.update(employeesTable).set(updates).where(eq(employeesTable.id, id)).returning();
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
