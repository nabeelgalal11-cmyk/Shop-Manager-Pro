import { Router, type IRouter } from "express";
import { db, paymentsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { getUser, requirePermission } from "../lib/auth.js";
import { recordPayment, reversePayment, WorkflowError } from "../lib/repair-workflow.js";

const router: IRouter = Router();
const fail = (res: any, value: unknown) => {
  if (value instanceof WorkflowError) { res.status(value.status).json({ error: value.message }); return; }
  throw value;
};
router.get("/", requirePermission("payments", "view"), async (req, res): Promise<void> => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  res.json(await db.select().from(paymentsTable).orderBy(desc(paymentsTable.createdAt)).limit(limit));
});
router.get("/:id", requirePermission("payments", "view"), async (req, res): Promise<void> => {
  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, Number(req.params.id)));
  if (!payment) { res.status(404).json({ error: "Payment not found" }); return; }
  res.json(payment);
});
router.post("/", requirePermission("payments", "create"), async (req, res): Promise<void> => {
  try {
    const idempotencyKey = req.get("Idempotency-Key");
    if (!idempotencyKey) throw new WorkflowError("Idempotency-Key header is required");
    res.status(201).json(await recordPayment({ ...req.body, idempotencyKey, pending: !!req.body.processor }, getUser(req)!.id));
  } catch (value) { fail(res, value); }
});
router.post("/:id/refund", requirePermission("payments", "delete"), async (req, res): Promise<void> => {
  try {
    const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, Number(req.params.id)));
    if (!payment) throw new WorkflowError("Payment not found", 404);
    if (payment.processor) throw new WorkflowError("Processor payments must be refunded through the provider workflow", 409);
    res.status(201).json(await reversePayment(payment.id, "refunded", req.body.amount, String(req.body.reason ?? ""), getUser(req)!.id));
  } catch (value) { fail(res, value); }
});
router.post("/:id/void", requirePermission("payments", "delete"), async (req, res): Promise<void> => {
  try {
    const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, Number(req.params.id)));
    if (!payment) throw new WorkflowError("Payment not found", 404);
    if (payment.processor) throw new WorkflowError("Processor payments must be voided through the provider workflow", 409);
    res.status(201).json(await reversePayment(payment.id, "void", req.body.amount, String(req.body.reason ?? ""), getUser(req)!.id));
  } catch (value) { fail(res, value); }
});
router.delete("/:id", (_req, res): void => { res.status(405).json({ error: "Payments are immutable; use refund or void" }); });
export default router;