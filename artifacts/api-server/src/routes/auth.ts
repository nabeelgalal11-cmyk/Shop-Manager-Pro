import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, employeesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getUser, issueMobileToken, recordLogin, requireAuth } from "../lib/auth.js";
import { getPermissionsForRoles, RESOURCES, ACTIONS } from "../lib/permissions.js";
import { escapeHtml, sendTemplatedEmail } from "../lib/email.js";
import { logger } from "../lib/logger.js";

const router: Router = Router();

const forgotPasswordCooldownMs = 60_000;
const forgotPasswordRequests = new Map<string, number>();
const forgotPasswordMessage =
  "If an account matches the information provided, an administrator will review the request.";

function isPrivileged(emp: { role: string; roles: string[] }, role: string): boolean {
  const roles = emp.roles?.length ? emp.roles : [emp.role];
  return roles.some((value) => value.toLowerCase() === role);
}

router.post("/forgot-password", async (req, res) => {
  const rawIdentifier = req.body?.identifier;
  const identifier = typeof rawIdentifier === "string" ? rawIdentifier.trim().toLowerCase() : "";
  if (!identifier || identifier.length > 254) {
    return res.status(400).json({ error: "Identifier is required" });
  }

  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const rateKey = `${ip}:${identifier}`;
  const now = Date.now();
  const lastRequest = forgotPasswordRequests.get(rateKey);
  if (lastRequest && now - lastRequest < forgotPasswordCooldownMs) {
    return res.json({ ok: true, message: forgotPasswordMessage });
  }
  forgotPasswordRequests.set(rateKey, now);
  if (forgotPasswordRequests.size > 10_000) {
    for (const [key, timestamp] of forgotPasswordRequests) {
      if (now - timestamp >= forgotPasswordCooldownMs) forgotPasswordRequests.delete(key);
    }
  }

  try {
    const employees = await db.select().from(employeesTable).where(eq(employeesTable.active, true));
    const requester = employees.find((employee) =>
      (employee.username?.toLowerCase() === identifier || employee.email?.toLowerCase() === identifier),
    );
    if (requester) {
      const admins = employees.filter((employee) => employee.email && isPrivileged(employee, "admin"));
      const recipients = admins.length > 0
        ? admins
        : employees.filter((employee) => employee.email && isPrivileged(employee, "manager"));
      const vars = {
        requesterUsername: escapeHtml(requester.username || ""),
        requesterName: escapeHtml(`${requester.firstName} ${requester.lastName}`.trim()),
        requesterEmail: escapeHtml(requester.email || "Not provided"),
        requestedAt: escapeHtml(new Date(now).toISOString()),
      };
      await Promise.all(recipients.map(async (recipient) => {
        try {
          const result = await sendTemplatedEmail("password_reset_request", recipient.email!, vars);
          if (!result.ok) logger.warn({ template: "password_reset_request" }, "Password reset notification could not be delivered");
        } catch (error) {
          logger.warn({ err: error instanceof Error ? error.message : "unknown" }, "Password reset notification failed");
        }
      }));
    }
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : "unknown" }, "Password reset request processing failed");
  }
  return res.json({ ok: true, message: forgotPasswordMessage });
});

router.post("/login", async (req, res) => {
  const { username, password, mobile } = req.body || {};
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
  const mobileAuth = mobile === true ? issueMobileToken(emp.id) : null;
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
    ...(mobileAuth ? {
      mobileToken: mobileAuth.token,
      mobileTokenExpiresAt: mobileAuth.expiresAt.toISOString(),
    } : {}),
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
