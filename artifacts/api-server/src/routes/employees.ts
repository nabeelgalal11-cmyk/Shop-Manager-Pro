import { Router } from "express";
import { db } from "@workspace/db";
import { employeesTable, timeEntriesTable } from "@workspace/db";
import { eq, sql, desc, and, or } from "drizzle-orm";
import { getUser, requirePermission } from "../lib/auth.js";
import { getPermissionsForRoles, hasPermission } from "../lib/permissions.js";
import { revokeUserSessions } from "../lib/auth-storage.js";

const router: Router = Router();
const employeeFields = {
  id: employeesTable.id,
  username: employeesTable.username,
  firstName: employeesTable.firstName,
  lastName: employeesTable.lastName,
  email: employeesTable.email,
  phone: employeesTable.phone,
  role: employeesTable.role,
  roles: employeesTable.roles,
  hourlyRate: employeesTable.hourlyRate,
  active: employeesTable.active,
  hireDate: employeesTable.hireDate,
  notes: employeesTable.notes,
  clockedIn: employeesTable.clockedIn,
  createdAt: employeesTable.createdAt,
  updatedAt: employeesTable.updatedAt,
};

router.get("/", async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "Authentication required" });
  const permissions = await getPermissionsForRoles(user.roles);
  const canViewEmployees = hasPermission(permissions, "employees", "view");
  const canViewRepairOrders = hasPermission(permissions, "repair_orders", "view");
  if (!canViewEmployees && !canViewRepairOrders) return res.status(403).json({ error: "Permission denied" });

  const role = req.query.role as string | undefined;
  const active = req.query.active !== undefined ? req.query.active === "true" : undefined;

  // The repair-order board needs technician names, not the full HR record.
  // Keep this limited projection available to repair-order viewers only.
  if (!canViewEmployees) {
    if (!canViewRepairOrders || role !== "technician") {
      return res.status(403).json({ error: "Permission denied" });
    }
    const technicians = await db
      .select({
        id: employeesTable.id,
        firstName: employeesTable.firstName,
        lastName: employeesTable.lastName,
        role: employeesTable.role,
        roles: employeesTable.roles,
        active: employeesTable.active,
      })
      .from(employeesTable)
      .where(or(
        sql`'technician' = ANY(${employeesTable.roles})`,
        and(
          sql`coalesce(array_length(${employeesTable.roles}, 1), 0) = 0`,
          eq(employeesTable.role, "technician"),
        ),
      ))
      .orderBy(desc(employeesTable.createdAt));
    return res.json(active === undefined ? technicians : technicians.filter((employee) => employee.active === active));
  }

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
    ? db.select(employeeFields).from(employeesTable).where(where).orderBy(desc(employeesTable.createdAt))
    : db.select(employeeFields).from(employeesTable).orderBy(desc(employeesTable.createdAt)));

  res.json(employees);
});

router.post("/", requirePermission("employees", "create"), async (req, res) => {
  const { firstName, lastName, email, phone, role, roles, hourlyRate, active, hireDate, notes } = req.body;
  if (role !== undefined || roles !== undefined) {
    const user = getUser(req);
    if (!user?.roles.includes("admin")) return res.status(403).json({ error: "Only admins may assign account roles" });
  }
  const rolesArr: string[] = Array.isArray(roles) && roles.length > 0
    ? roles
    : (role ? [role] : []);
  const primaryRole: string = role || rolesArr[0] || "technician";
  const [employee] = await db.insert(employeesTable).values({
    firstName, lastName, email, phone,
    role: primaryRole,
    roles: rolesArr,
    hourlyRate, active: active ?? true, hireDate, notes,
  }).returning(employeeFields);
  res.status(201).json(employee);
});

router.get("/:id", requirePermission("employees", "view"), async (req, res) => {
  const [employee] = await db.select(employeeFields).from(employeesTable).where(eq(employeesTable.id, Number(req.params.id)));
  if (!employee) return res.status(404).json({ error: "Employee not found" });
  res.json(employee);
});

router.put("/:id", requirePermission("employees", "edit"), async (req, res) => {
  const id = Number(req.params.id);
  const { firstName, lastName, email, phone, role, roles, hourlyRate, active, hireDate, notes } = req.body;
  const user = getUser(req);
  if (role !== undefined || roles !== undefined) {
    if (!user?.roles.includes("admin")) return res.status(403).json({ error: "Only admins may assign account roles" });
  }
  const updates: any = { updatedAt: new Date() };
  if (firstName !== undefined) updates.firstName = firstName;
  if (lastName !== undefined) updates.lastName = lastName;
  if (email !== undefined) updates.email = email;
  if (phone !== undefined) updates.phone = phone;
  if (hourlyRate !== undefined) updates.hourlyRate = hourlyRate;
  if (active !== undefined) updates.active = active;
  if (active === false) updates.authVersion = sql`${employeesTable.authVersion} + 1`;
  if (hireDate !== undefined) updates.hireDate = hireDate;
  if (notes !== undefined) updates.notes = notes;
  if (Array.isArray(roles)) {
    updates.roles = roles;
    if (!role && roles.length > 0) updates.role = roles[0];
  }
  if (role !== undefined) updates.role = role;
  const [employee] = await db.update(employeesTable).set(updates).where(eq(employeesTable.id, id)).returning(employeeFields);
  if (!employee) return res.status(404).json({ error: "Employee not found" });
  if (active === false) await revokeUserSessions(id);
  res.json(employee);
});

router.delete("/:id", requirePermission("employees", "delete"), async (req, res) => {
  const id = Number(req.params.id);
  await revokeUserSessions(id);
  await db.delete(employeesTable).where(eq(employeesTable.id, id));
  res.status(204).send();
});

router.post("/:id/clock-in", async (req, res) => {
  const id = Number(req.params.id);
  const user = getUser(req);
  if (!user || (user.id !== id && !user.roles.some((role) => role === "admin" || role === "manager"))) {
    return res.status(403).json({ error: "You may only clock in for yourself" });
  }
  const repairOrderId = req.body?.repairOrderId ? Number(req.body.repairOrderId) : null;
  await db.update(employeesTable).set({ clockedIn: true, updatedAt: new Date() }).where(eq(employeesTable.id, id));
  const [entry] = await db.insert(timeEntriesTable).values({ employeeId: id, clockIn: new Date(), repairOrderId }).returning();
  res.status(201).json(entry);
});

router.post("/:id/clock-out", async (req, res) => {
  const id = Number(req.params.id);
  const user = getUser(req);
  if (!user || (user.id !== id && !user.roles.some((role) => role === "admin" || role === "manager"))) {
    return res.status(403).json({ error: "You may only clock out for yourself" });
  }
  const clockOut = new Date();
  const openEntry = await db.select().from(timeEntriesTable).where(eq(timeEntriesTable.employeeId, id)).orderBy(desc(timeEntriesTable.clockIn)).limit(1);
  if (!openEntry[0]) return res.status(400).json({ error: "No open time entry" });
  const hours = (clockOut.getTime() - new Date(openEntry[0].clockIn).getTime()) / 3600000;
  const [entry] = await db.update(timeEntriesTable).set({ clockOut, totalHours: hours.toFixed(2) }).where(eq(timeEntriesTable.id, openEntry[0].id)).returning();
  await db.update(employeesTable).set({ clockedIn: false, updatedAt: new Date() }).where(eq(employeesTable.id, id));
  res.json(entry);
});

export default router;
