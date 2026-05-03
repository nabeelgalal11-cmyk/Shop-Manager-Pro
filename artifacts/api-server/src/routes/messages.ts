import { Router } from "express";
import { db, messagesTable, customersTable } from "@workspace/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { sendSms, markCustomerThreadRead } from "../lib/sms.js";

const router: Router = Router();

// GET /api/messages?customerId=123  — full thread for one customer
// GET /api/messages/unread-count    — total unread inbound messages
// POST /api/messages                — admin sends SMS to a customer
// POST /api/messages/:customerId/read — mark thread read

router.get("/unread-count", async (_req, res) => {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messagesTable)
    .where(and(eq(messagesTable.direction, "inbound"), isNull(messagesTable.readAt)));
  res.json({ count: row?.count ?? 0 });
});

router.get("/recent-threads", async (_req, res) => {
  // Latest message per customer with at least one inbound message ever.
  const rows = await db
    .select({
      messageId: messagesTable.id,
      customerId: messagesTable.customerId,
      direction: messagesTable.direction,
      body: messagesTable.body,
      status: messagesTable.status,
      readAt: messagesTable.readAt,
      createdAt: messagesTable.createdAt,
      firstName: customersTable.firstName,
      lastName: customersTable.lastName,
    })
    .from(messagesTable)
    .innerJoin(customersTable, eq(customersTable.id, messagesTable.customerId))
    .orderBy(desc(messagesTable.createdAt))
    .limit(100);

  // Dedupe by customer (keep first/most recent occurrence).
  const seen = new Set<number>();
  const threads = [] as typeof rows;
  for (const r of rows) {
    if (seen.has(r.customerId)) continue;
    seen.add(r.customerId);
    threads.push(r);
    if (threads.length >= 20) break;
  }
  res.json({ threads });
});

router.get("/", async (req, res) => {
  const customerId = Number(req.query.customerId);
  if (!Number.isFinite(customerId) || customerId <= 0) {
    return res.status(400).json({ error: "customerId is required" });
  }
  const rows = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.customerId, customerId))
    .orderBy(messagesTable.createdAt);
  res.json({ messages: rows });
});

router.post("/", async (req, res) => {
  const customerId = Number(req.body?.customerId);
  const body = String(req.body?.body ?? "").trim();
  if (!customerId || !body) {
    return res.status(400).json({ error: "customerId and body are required" });
  }
  const repairOrderId = req.body?.repairOrderId ? Number(req.body.repairOrderId) : null;
  const estimateId = req.body?.estimateId ? Number(req.body.estimateId) : null;
  const invoiceId = req.body?.invoiceId ? Number(req.body.invoiceId) : null;
  const userId = (req as any).user?.id ?? null;

  const result = await sendSms({
    customerId,
    body,
    repairOrderId,
    estimateId,
    invoiceId,
    sentByUserId: userId,
  });
  if (!result.ok) {
    const status =
      result.reason === "not_configured" ? 503 :
      result.reason === "no_phone" ? 400 :
      result.reason === "opted_out" ? 409 :
      500;
    return res.status(status).json({ error: result.error, reason: result.reason });
  }
  res.status(201).json({ ok: true, messageId: result.messageId, twilioSid: result.twilioSid });
});

router.post("/:customerId/read", async (req, res) => {
  const customerId = Number(req.params.customerId);
  if (!Number.isFinite(customerId) || customerId <= 0) {
    return res.status(400).json({ error: "Invalid customerId" });
  }
  await markCustomerThreadRead(customerId);
  res.json({ ok: true });
});

export default router;
