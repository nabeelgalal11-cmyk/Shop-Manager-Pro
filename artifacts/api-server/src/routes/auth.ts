import { Router, type Request } from "express";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { db, employeesTable, passwordResetTokensTable } from "@workspace/db";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getUser, issueMobileToken, recordLogin, requireAuth } from "../lib/auth.js";
import { getPermissionsForRoles, RESOURCES, ACTIONS } from "../lib/permissions.js";
import { escapeHtml, sendTemplatedEmail } from "../lib/email.js";
import { logger } from "../lib/logger.js";

const router: Router = Router();

const forgotPasswordCooldownMs = 60_000;
const forgotPasswordRequests = new Map<string, number>();
const forgotPasswordMessage =
  "If this is an eligible account, follow the secure link sent by email; otherwise an administrator will review the request.";

function isPrivileged(emp: { role: string; roles: string[] }, role: string): boolean {
  const roles = emp.roles?.length ? emp.roles : [emp.role];
  return roles.some((value) => value.toLowerCase() === role);
}

function getPublicOrigin(req: Request): string {
  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || req.get("host");
  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || req.protocol;
  if (host) return `${protocol}://${host}`;

  const configuredBaseUrl = process.env.PUBLIC_BASE_URL?.trim();
  if (configuredBaseUrl) {
    try {
      const parsed = new URL(configuredBaseUrl);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.origin;
      }
    } catch {
      // Fall through to the request protocol if the fallback is invalid.
    }
  }

  return `${protocol}://localhost`;
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
      if (requester.email && isPrivileged(requester, "admin")) {
        const rawToken = randomBytes(32).toString("hex");
        const tokenHash = createHash("sha256").update(rawToken).digest("hex");
        const expiresAt = new Date(now + 30 * 60 * 1000);
        await db.transaction(async (tx) => {
          await tx.update(passwordResetTokensTable)
            .set({ usedAt: new Date(now) })
            .where(and(eq(passwordResetTokensTable.employeeId, requester.id), isNull(passwordResetTokensTable.usedAt)));
          await tx.insert(passwordResetTokensTable).values({
            employeeId: requester.id,
            tokenHash,
            expiresAt,
          });
        });
        const origin = getPublicOrigin(req);
        const resetUrl = escapeHtml(`${origin}/reset-password?token=${encodeURIComponent(rawToken)}`);
        try {
          const result = await sendTemplatedEmail("password_reset_self_service", requester.email, {
            requesterName: escapeHtml(`${requester.firstName} ${requester.lastName}`.trim()),
            resetUrl,
            expiresIn: "30 minutes",
          });
          if (!result.ok) logger.warn({ template: "password_reset_self_service" }, "Self-service password reset email could not be delivered");
        } catch (error) {
          logger.warn({ err: error instanceof Error ? error.message : "unknown" }, "Self-service password reset email failed");
        }
      }
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

router.post("/reset-password", async (req, res) => {
  const rawToken = typeof req.body?.token === "string" ? req.body.token : "";
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
  if (newPassword.length < 6 || !rawToken) {
    return res.status(400).json({ error: "Invalid or expired reset request" });
  }
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const now = new Date();
  try {
    const result = await db.transaction(async (tx) => {
      const [token] = await tx.select().from(passwordResetTokensTable).where(and(
        eq(passwordResetTokensTable.tokenHash, tokenHash),
        isNull(passwordResetTokensTable.usedAt),
        gt(passwordResetTokensTable.expiresAt, now),
      )).limit(1);
      if (!token) return false;
      const [claimed] = await tx.update(passwordResetTokensTable)
        .set({ usedAt: now })
        .where(and(eq(passwordResetTokensTable.id, token.id), isNull(passwordResetTokensTable.usedAt)))
        .returning({ id: passwordResetTokensTable.id });
      if (!claimed) return false;
      const passwordHash = await bcrypt.hash(newPassword, 10);
      await tx.update(employeesTable).set({ passwordHash, updatedAt: now })
        .where(and(eq(employeesTable.id, token.employeeId), eq(employeesTable.active, true)));
      return true;
    });
    if (!result) return res.status(400).json({ error: "Invalid or expired reset request" });
    return res.json({ ok: true, message: "Password reset successfully" });
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : "unknown" }, "Password reset failed");
    return res.status(400).json({ error: "Invalid or expired reset request" });
  }
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
