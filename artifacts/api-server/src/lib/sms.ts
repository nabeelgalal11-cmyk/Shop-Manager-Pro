import twilio from "twilio";
import type { Twilio } from "twilio";
import { db, shopSettingsTable, messagesTable, customersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger.js";

export interface TwilioSettings {
  accountSid: string | null;
  authToken: string | null;
  fromNumber: string | null;
}

export async function getTwilioSettings(): Promise<TwilioSettings> {
  const [row] = await db.select().from(shopSettingsTable).limit(1);
  return {
    accountSid: row?.twilioAccountSid ?? null,
    authToken: row?.twilioAuthToken ?? null,
    fromNumber: row?.twilioFromNumber ?? null,
  };
}

export async function getTwilioClient(): Promise<{ client: Twilio; from: string }> {
  const { accountSid, authToken, fromNumber } = await getTwilioSettings();
  if (!accountSid || !authToken || !fromNumber) {
    throw new Error("Twilio not configured. Add credentials in Settings → Messaging.");
  }
  return { client: twilio(accountSid, authToken), from: fromNumber };
}

/** Normalize a raw phone string to E.164. Defaults to US (+1) when no country code. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export interface SendSmsOpts {
  customerId: number;
  body: string;
  /** When omitted, falls back to the customer's stored phone. */
  toNumber?: string | null;
  repairOrderId?: number | null;
  estimateId?: number | null;
  invoiceId?: number | null;
  sentByUserId?: number | null;
  /** When true, ignores the smsOptOut flag (e.g. transactional STOP confirmations). */
  bypassOptOut?: boolean;
}

export interface SendSmsResult {
  ok: boolean;
  messageId?: number;
  twilioSid?: string;
  error?: string;
  reason?: "not_configured" | "no_phone" | "opted_out" | "send_failed";
}

/**
 * Send an SMS to a customer and persist both the outbound row and the
 * Twilio status. Returns ok=false (with `reason`) for "expected" failures so
 * callers can branch on them without try/catch.
 */
export async function sendSms(opts: SendSmsOpts): Promise<SendSmsResult> {
  const [customer] = await db
    .select()
    .from(customersTable)
    .where(eq(customersTable.id, opts.customerId));
  if (!customer) return { ok: false, reason: "send_failed", error: "Customer not found" };

  if (!opts.bypassOptOut && customer.smsOptOut === "true") {
    return { ok: false, reason: "opted_out", error: "Customer has opted out of SMS" };
  }

  const to = normalizePhone(opts.toNumber ?? customer.phone);
  if (!to) return { ok: false, reason: "no_phone", error: "No valid phone number on file" };

  let client: Twilio;
  let from: string;
  try {
    ({ client, from } = await getTwilioClient());
  } catch (err: any) {
    return { ok: false, reason: "not_configured", error: err.message };
  }

  // Persist as queued first so we have a stable id for the status callback.
  const [stored] = await db
    .insert(messagesTable)
    .values({
      customerId: opts.customerId,
      repairOrderId: opts.repairOrderId ?? null,
      estimateId: opts.estimateId ?? null,
      invoiceId: opts.invoiceId ?? null,
      direction: "outbound",
      channel: "sms",
      fromNumber: from,
      toNumber: to,
      body: opts.body,
      status: "queued",
      sentByUserId: opts.sentByUserId ?? null,
    })
    .returning();

  const statusCallback = buildStatusCallbackUrl(stored.id);

  try {
    const msg = await client.messages.create({
      to,
      from,
      body: opts.body,
      ...(statusCallback ? { statusCallback } : {}),
    });
    await db
      .update(messagesTable)
      .set({ status: "sent", twilioSid: msg.sid, updatedAt: new Date() })
      .where(eq(messagesTable.id, stored.id));
    return { ok: true, messageId: stored.id, twilioSid: msg.sid };
  } catch (err: any) {
    const reason = err?.message || "Twilio send failed";
    await db
      .update(messagesTable)
      .set({ status: "failed", failureReason: reason, updatedAt: new Date() })
      .where(eq(messagesTable.id, stored.id));
    logger.error({ err: reason, customerId: opts.customerId }, "Twilio send failed");
    return { ok: false, reason: "send_failed", error: reason, messageId: stored.id };
  }
}

function buildStatusCallbackUrl(_messageId: number): string | undefined {
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
  if (!base) return undefined;
  // Twilio posts the MessageSid back; we look the row up by twilio_sid (set
  // synchronously above) inside the callback handler.
  return `${base}/api/twilio/status`;
}

/** Find a customer by inbound from-number. Tries E.164 + last-10 digits. */
export async function findCustomerByPhone(rawFrom: string): Promise<{ id: number } | null> {
  const e164 = normalizePhone(rawFrom);
  const last10 = (rawFrom.replace(/\D/g, "") || "").slice(-10);
  if (!e164 && !last10) return null;
  // Customers may have phones stored in various formats — match on both
  // exact E.164 and the last 10 digits via LIKE.
  const rows = await db.select().from(customersTable);
  for (const c of rows) {
    if (!c.phone) continue;
    const cE = normalizePhone(c.phone);
    if (e164 && cE === e164) return { id: c.id };
    const cLast = c.phone.replace(/\D/g, "").slice(-10);
    if (last10 && cLast && cLast === last10) return { id: c.id };
  }
  return null;
}

/** Apply STOP/START opt-out keyword logic. Returns true if a keyword was handled. */
export async function applyOptOutKeyword(customerId: number, body: string): Promise<"opt_out" | "opt_in" | null> {
  const word = body.trim().toUpperCase();
  if (["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(word)) {
    await db
      .update(customersTable)
      .set({ smsOptOut: "true", updatedAt: new Date() })
      .where(eq(customersTable.id, customerId));
    return "opt_out";
  }
  if (["START", "UNSTOP", "YES"].includes(word)) {
    await db
      .update(customersTable)
      .set({ smsOptOut: "false", updatedAt: new Date() })
      .where(eq(customersTable.id, customerId));
    return "opt_in";
  }
  return null;
}

/** Mark an entire customer's inbound thread as read. */
export async function markCustomerThreadRead(customerId: number): Promise<void> {
  await db
    .update(messagesTable)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(messagesTable.customerId, customerId),
        eq(messagesTable.direction, "inbound"),
      ),
    );
}
