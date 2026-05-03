import { Router, type Request, type Response } from "express";
import twilio from "twilio";
import { db, messagesTable, customersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  applyOptOutKeyword,
  findCustomerByPhone,
  getTwilioSettings,
  sendSms,
} from "../lib/sms.js";
import { logger } from "../lib/logger.js";

const router: Router = Router();

/**
 * Verify Twilio's X-Twilio-Signature header. Fails CLOSED — these endpoints
 * are mounted before requireAuth, so an unverified request must never be
 * allowed to mutate state (insert messages, opt customers in/out, etc.).
 */
async function verifyTwilioSignature(req: Request, res: Response): Promise<boolean> {
  const settings = await getTwilioSettings();
  if (!settings.authToken) {
    logger.warn("Twilio webhook received but auth token not configured; rejecting");
    res.status(503).send("Twilio not configured");
    return false;
  }
  const sig = req.header("X-Twilio-Signature") || "";
  // Twilio computes the signature from the full URL it called. Behind the
  // Replit/Render proxy the inbound req.protocol/host can be wrong, so prefer
  // PUBLIC_BASE_URL when available.
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "")
    || `${req.protocol}://${req.get("host")}`;
  const url = `${base}${req.originalUrl}`;
  const valid = twilio.validateRequest(settings.authToken, sig, url, req.body || {});
  if (!valid) {
    logger.warn({ url }, "Twilio signature verification failed");
    res.status(403).send("Invalid signature");
    return false;
  }
  return true;
}

/** Inbound SMS webhook (Twilio configures this as the Messaging URL). */
router.post("/inbound", async (req, res) => {
  if (!(await verifyTwilioSignature(req, res))) return;

  const from = String(req.body?.From || "");
  const to = String(req.body?.To || "");
  const body = String(req.body?.Body || "");
  const sid = String(req.body?.MessageSid || "");
  if (!from || !body) return res.status(200).type("text/xml").send("<Response/>");

  const matched = await findCustomerByPhone(from);

  if (!matched) {
    // Park the message under a synthetic record-keeping row? For v1 we just
    // log and acknowledge — shop can add the customer later.
    logger.warn({ from, body }, "Inbound SMS from unknown number");
    return res.status(200).type("text/xml").send("<Response/>");
  }

  await db.insert(messagesTable).values({
    customerId: matched.id,
    direction: "inbound",
    channel: "sms",
    fromNumber: from,
    toNumber: to,
    body,
    status: "received",
    twilioSid: sid || null,
  });

  // Honor STOP / START in the same lambda so the next outbound is gated.
  const action = await applyOptOutKeyword(matched.id, body);
  if (action === "opt_out") {
    // Confirmation back to the customer (transactional, bypasses opt-out flag
    // so it actually goes out).
    await sendSms({
      customerId: matched.id,
      body: "You have been unsubscribed and will no longer receive texts. Reply START to resubscribe.",
      bypassOptOut: true,
    }).catch((err) => logger.error({ err }, "STOP confirm send failed"));
  } else if (action === "opt_in") {
    await sendSms({
      customerId: matched.id,
      body: "You're resubscribed and will receive texts again. Reply STOP to unsubscribe.",
      bypassOptOut: true,
    }).catch((err) => logger.error({ err }, "START confirm send failed"));
  }

  // Empty TwiML — we send our own auto-reply via the API path so it gets
  // recorded as an outbound message in the thread (don't double-respond
  // here with TwiML <Message>).
  res.status(200).type("text/xml").send("<Response/>");
});

/** Status callback — Twilio posts delivery state transitions back. */
router.post("/status", async (req, res) => {
  if (!(await verifyTwilioSignature(req, res))) return;

  const sid = String(req.body?.MessageSid || "");
  const status = String(req.body?.MessageStatus || "");
  const errCode = req.body?.ErrorCode ? String(req.body.ErrorCode) : null;
  const errMsg = req.body?.ErrorMessage ? String(req.body.ErrorMessage) : null;
  if (!sid || !status) return res.status(200).end();

  const update: Record<string, unknown> = { status, updatedAt: new Date() };
  if (status === "failed" || status === "undelivered") {
    update.failureReason = errMsg || (errCode ? `Twilio error ${errCode}` : "Delivery failed");
  }
  await db.update(messagesTable).set(update).where(eq(messagesTable.twilioSid, sid));
  res.status(200).end();
});

export default router;
