import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, employeesTable } from "@workspace/db";
import { eq, sql, desc, isNotNull } from "drizzle-orm";
import { requireAuth, requirePermission } from "../lib/auth.js";

const router: Router = Router();

router.use(requireAuth);

// List all users (employees with usernames)
router.get("/", requirePermission("users", "view"), async (_req, res) => {
  const rows = await db
    .select({
      id: employeesTable.id,
      username: employeesTable.username,
      firstName: employeesTable.firstName,
      lastName: employeesTable.lastName,
      email: employeesTable.email,
      role: employeesTable.role,
      roles: employeesTable.roles,
      active: employeesTable.active,
      lastLoginAt: employeesTable.lastLoginAt,
      createdAt: employeesTable.createdAt,
    })
    .from(employeesTable)
    .where(isNotNull(employeesTable.username))
    .orderBy(desc(employeesTable.createdAt));
  res.json(rows);
});

// Create user (links to an existing employee or creates new)
router.post("/", requirePermission("users", "create"), async (req, res) => {
  const { employeeId, firstName, lastName, email, username, password, roles } = req.body || {};
  if (!username || !password || String(password).length < 6) {
    return res.status(400).json({ error: "Username and password (>=6 chars) required" });
  }
  const uname = String(username).toLowerCase().trim();
  const passwordHash = await bcrypt.hash(String(password), 10);
  const rolesArr: string[] = Array.isArray(roles) && roles.length > 0 ? roles : ["viewer"];
  const primaryRole = rolesArr[0];

  // Username uniqueness
  const [exists] = await db.select().from(employeesTable).where(eq(employeesTable.username, uname));
  if (exists) return res.status(409).json({ error: "Username already taken" });

  if (employeeId) {
    const [updated] = await db
      .update(employeesTable)
      .set({ username: uname, passwordHash, roles: rolesArr, role: primaryRole })
      .where(eq(employeesTable.id, Number(employeeId)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Employee not found" });
    return res.status(201).json({ id: updated.id });
  }

  if (!firstName || !lastName) {
    return res.status(400).json({ error: "firstName and lastName required for new user" });
  }
  const [created] = await db
    .insert(employeesTable)
    .values({
      firstName,
      lastName,
      email: email || null,
      role: primaryRole,
      roles: rolesArr,
      active: true,
      username: uname,
      passwordHash,
    })
    .returning();
  res.status(201).json({ id: created.id });
});

// Update user (roles, active, optionally reset password)
router.put("/:id", requirePermission("users", "edit"), async (req, res) => {
  const id = Number(req.params.id);
  const { roles, active, password, firstName, lastName, email } = req.body || {};
  const updates: Record<string, any> = {};
  if (Array.isArray(roles)) {
    updates.roles = roles;
    if (roles.length > 0) updates.role = roles[0];
  }
  if (typeof active === "boolean") updates.active = active;
  if (typeof firstName === "string") updates.firstName = firstName;
  if (typeof lastName === "string") updates.lastName = lastName;
  if (typeof email === "string") updates.email = email || null;
  if (password) {
    if (String(password).length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }
    updates.passwordHash = await bcrypt.hash(String(password), 10);
  }
  if (Object.keys(updates).length === 0) return res.json({ ok: true });
  updates.updatedAt = sql`now()`;
  const [updated] = await db.update(employeesTable).set(updates).where(eq(employeesTable.id, id)).returning();
  if (!updated) return res.status(404).json({ error: "User not found" });
  res.json({ ok: true });
});

// Delete user (revoke login, keep employee record)
router.delete("/:id", requirePermission("users", "delete"), async (req, res) => {
  const id = Number(req.params.id);
  await db
    .update(employeesTable)
    .set({ username: null, passwordHash: null, active: false })
    .where(eq(employeesTable.id, id));
  res.json({ ok: true });
});

export default router;
