import session from "express-session";
import createMemoryStore from "memorystore";
import type { RequestHandler, Request, Response, NextFunction } from "express";
import { db, employeesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getPermissionsForRoles, hasPermission, type Resource, type Action } from "./permissions.js";

const MemoryStore = createMemoryStore(session);

declare module "express-session" {
  interface SessionData {
    userId?: number;
  }
}

export interface AuthUser {
  id: number;
  username: string;
  firstName: string;
  lastName: string;
  email: string | null;
  role: string;
  roles: string[];
  active: boolean;
}

const isProd = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET;
if (isProd && !sessionSecret) {
  throw new Error("SESSION_SECRET environment variable is required in production");
}

const MOBILE_TOKEN_LIFETIME_SECONDS = 60 * 60 * 24 * 7;
type MobileTokenPayload = { sub: number; exp: number; typ: "mobile" };

function authSecret(): string {
  return sessionSecret || "dev-only-insecure-secret";
}

export function issueMobileToken(userId: number): { token: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + MOBILE_TOKEN_LIFETIME_SECONDS * 1000);
  const payload: MobileTokenPayload = {
    sub: userId,
    exp: Math.floor(expiresAt.getTime() / 1000),
    typ: "mobile",
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", authSecret()).update(encoded).digest("base64url");
  return { token: `${encoded}.${signature}`, expiresAt };
}

function verifyMobileToken(token: string): MobileTokenPayload | null {
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) return null;
  const expected = createHmac("sha256", authSecret()).update(encoded).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as MobileTokenPayload;
    if (payload.typ !== "mobile" || !Number.isSafeInteger(payload.sub) || payload.sub <= 0) return null;
    if (!Number.isSafeInteger(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export const sessionMiddleware: RequestHandler = session({
  secret: sessionSecret || "dev-only-insecure-secret",
  resave: false,
  saveUninitialized: false,
  store: new MemoryStore({ checkPeriod: 24 * 60 * 60 * 1000 }),
  proxy: isProd,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
  },
});

async function loadUser(userId: number): Promise<AuthUser | null> {
  const [row] = await db
    .select({
      id: employeesTable.id,
      username: employeesTable.username,
      firstName: employeesTable.firstName,
      lastName: employeesTable.lastName,
      email: employeesTable.email,
      role: employeesTable.role,
      roles: employeesTable.roles,
      active: employeesTable.active,
    })
    .from(employeesTable)
    .where(eq(employeesTable.id, userId));

  if (!row || !row.username) return null;
  return {
    id: row.id,
    username: row.username,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    role: row.role,
    roles: row.roles && row.roles.length > 0 ? row.roles : [row.role],
    active: row.active,
  };
}

export const attachUser: RequestHandler = async (req, _res, next) => {
  const authorization = req.get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const tokenPayload = bearer ? verifyMobileToken(bearer) : null;
  const userId = bearer ? tokenPayload?.sub : req.session?.userId;
  if (userId) {
    const user = await loadUser(userId);
    if (user && user.active) {
      (req as any).user = user;
    } else if (!bearer) {
      req.session.userId = undefined;
    }
  }
  next();
};

export function getUser(req: Request): AuthUser | null {
  return (req as any).user || null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!getUser(req)) return res.status(401).json({ error: "Not authenticated" });
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const u = getUser(req);
    if (!u) return res.status(401).json({ error: "Not authenticated" });
    if (!u.roles.some((r) => roles.includes(r))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

export function requirePermission(resource: Resource, action: Action) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const u = getUser(req);
    if (!u) return res.status(401).json({ error: "Not authenticated" });
    if (u.roles.includes("admin")) return next();
    const perms = await getPermissionsForRoles(u.roles);
    if (!hasPermission(perms, resource, action)) {
      return res.status(403).json({ error: "Forbidden", resource, action });
    }
    next();
  };
}

export async function recordLogin(userId: number): Promise<void> {
  await db
    .update(employeesTable)
    .set({ lastLoginAt: sql`now()` })
    .where(eq(employeesTable.id, userId));
}
