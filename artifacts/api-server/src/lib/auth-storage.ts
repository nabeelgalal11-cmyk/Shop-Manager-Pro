import session, { type SessionData } from "express-session";
import { pool } from "@workspace/db";
import { logger } from "./logger.js";

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const AUTH_STORAGE_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

function sessionExpiry(data: SessionData): Date {
  const cookieExpiry = data.cookie?.expires;
  if (cookieExpiry) return new Date(cookieExpiry);

  const maxAge = data.cookie?.originalMaxAge;
  return new Date(Date.now() + (typeof maxAge === "number" ? maxAge : SESSION_LIFETIME_MS));
}

export class PostgresSessionStore extends session.Store {
  get(
    sid: string,
    callback: (err: unknown, session?: SessionData | null) => void,
  ): void {
    void pool.query(
      `SELECT sess
       FROM auth_sessions
       WHERE sid = $1 AND expire > now()`,
      [sid],
    ).then(({ rows }) => callback(null, rows[0]?.sess ?? null))
      .catch((error: unknown) => callback(error));
  }

  set(sid: string, data: SessionData, callback?: (err?: unknown) => void): void {
    void pool.query(
      `INSERT INTO auth_sessions (sid, sess, expire)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (sid) DO UPDATE
       SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
      [sid, JSON.stringify(data), sessionExpiry(data)],
    ).then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }

  touch(sid: string, data: SessionData, callback?: (err?: unknown) => void): void {
    void pool.query(
      `UPDATE auth_sessions
       SET sess = $2::jsonb, expire = $3
       WHERE sid = $1`,
      [sid, JSON.stringify(data), sessionExpiry(data)],
    ).then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }

  destroy(sid: string, callback?: (err?: unknown) => void): void {
    void pool.query("DELETE FROM auth_sessions WHERE sid = $1", [sid])
      .then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }

  destroyUserSessions(userId: number): Promise<void> {
    return pool.query(
      "DELETE FROM auth_sessions WHERE sess->>'userId' = $1",
      [String(userId)],
    ).then(() => undefined);
  }
}

export const persistentSessionStore = new PostgresSessionStore();

const cleanupTimer = setInterval(() => {
  void Promise.all([
    pool.query("DELETE FROM auth_sessions WHERE expire <= now()"),
    pool.query("DELETE FROM auth_login_attempts WHERE expires_at <= now()"),
  ]).catch((error: unknown) => {
    logger.warn({ err: error }, "Expired authentication state cleanup failed");
  });
}, AUTH_STORAGE_CLEANUP_INTERVAL_MS);
cleanupTimer.unref();

export interface LoginAttemptResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export class PostgresLoginAttemptLimiter {
  async reserve(ip: string): Promise<LoginAttemptResult> {
    const { rows: [row] } = await pool.query(
      `INSERT INTO auth_login_attempts (ip, attempt_count, expires_at)
       VALUES ($1, 1, now() + ($2 * interval '1 millisecond'))
       ON CONFLICT (ip) DO UPDATE
       SET attempt_count = CASE
             WHEN auth_login_attempts.expires_at <= now() THEN 1
             ELSE auth_login_attempts.attempt_count + 1
           END,
           expires_at = CASE
             WHEN auth_login_attempts.expires_at <= now()
               THEN now() + ($2 * interval '1 millisecond')
             ELSE auth_login_attempts.expires_at
           END
       RETURNING attempt_count, expires_at`,
      [ip, LOGIN_WINDOW_MS],
    );

    const attemptCount = Number(row.attempt_count);
    if (attemptCount <= LOGIN_MAX_ATTEMPTS) return { allowed: true };
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((new Date(row.expires_at).getTime() - Date.now()) / 1000)),
    };
  }

  async clear(ip: string): Promise<void> {
    await pool.query("DELETE FROM auth_login_attempts WHERE ip = $1", [ip]);
  }
}

export const loginAttemptLimiter = new PostgresLoginAttemptLimiter();

export async function revokeUserSessions(userId: number): Promise<void> {
  await persistentSessionStore.destroyUserSessions(userId);
}
