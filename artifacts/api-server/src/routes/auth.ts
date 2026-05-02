import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, employeesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getUser, recordLogin, requireAuth } from "../lib/auth.js";
import { getPermissionsForRoles, RESOURCES, ACTIONS } from "../lib/permissions.js";

const router: Router = Router();

router.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }
  const [emp] = await db
    .select()
    .from(employeesTable)
    .where(eq(employeesTable.username, String(username).toLowerCase().trim()));

  if (!emp || !emp.passwordHash || !emp.active) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const ok = await bcrypt.compare(String(password), emp.passwordHash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  // Regenerate session ID to prevent session fixation
  await new Promise<void>((resolve, reject) =>
    req.session.regenerate((err) => (err ? reject(err) : resolve())),
  );
  req.session.userId = emp.id;
  await new Promise<void>((resolve, reject) =>
    req.session.save((err) => (err ? reject(err) : resolve())),
  );
  await recordLogin(emp.id);

  const roles = emp.roles && emp.roles.length > 0 ? emp.roles : [emp.role];
  const permsSet = await getPermissionsForRoles(roles);
  res.json({
    user: {
      id: emp.id,
      username: emp.username,
      firstName: emp.firstName,
      lastName: emp.lastName,
      email: emp.email,
      role: emp.role,
      roles,
      active: emp.active,
    },
    permissions: Array.from(permsSet),
  });
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

router.get("/me", requireAuth, async (req, res) => {
  const u = getUser(req)!;
  const permsSet = await getPermissionsForRoles(u.roles);
  res.json({
    user: u,
    permissions: Array.from(permsSet),
    resources: RESOURCES,
    actions: ACTIONS,
  });
});

router.post("/change-password", requireAuth, async (req, res) => {
  const u = getUser(req)!;
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || String(newPassword).length < 6) {
    return res.status(400).json({ error: "New password must be at least 6 characters" });
  }
  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, u.id));
  if (!emp || !emp.passwordHash) return res.status(404).json({ error: "User not found" });
  const ok = await bcrypt.compare(String(currentPassword), emp.passwordHash);
  if (!ok) return res.status(401).json({ error: "Current password incorrect" });
  const passwordHash = await bcrypt.hash(String(newPassword), 10);
  await db.update(employeesTable).set({ passwordHash }).where(eq(employeesTable.id, u.id));
  res.json({ ok: true });
});

export default router;
