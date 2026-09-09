import { Router, type IRouter } from "express";
import { db, invoiceItemsTable, invoicesTable, paymentsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { getUser, requirePermission } from "../lib/auth.js";
import { issueInvoice, voidInvoice, WorkflowError } from "../lib/repair-workflow.js";
const router: IRouter = Router();
const fail = (res: any, value: unknown) => { if (value instanceof WorkflowError) { res.status(value.status).json({ error: value.message }); return; } throw value; };
router.get("/", requirePermission("invoices", "view"), async (req, res): Promise<void> => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  res.json(await db.select().from(invoicesTable).orderBy(desc(invoicesTable.createdAt)).limit(limit));
});
router.get("/:id", requirePermission("invoices", "view"), async (req, res): Promise<void> => {
  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, Number(req.params.id)));
  if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }
  const [items, payments] = await Promise.all([db.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.invoiceId, invoice.id)), db.select().from(paymentsTable).where(eq(paymentsTable.invoiceId, invoice.id))]);
  res.json({ ...invoice, items, payments });
});
router.post("/:id/issue", requirePermission("invoices", "edit"), async (req, res): Promise<void> => {
  try {
    const invoice = await issueInvoice(Number(req.params.id), getUser(req)!.id);
    const rawBase = process.env.PUBLIC_BASE_URL;
    let paymentUrl: string | null = null;
    if (rawBase && invoice.publicToken) {
      const base = new URL(rawBase);
      if (!["https:", "http:"].includes(base.protocol) || base.username || base.password) throw new WorkflowError("PUBLIC_BASE_URL must be an absolute HTTP(S) URL", 503);
      paymentUrl = new URL(`/pay/${invoice.publicToken}`, base).href;
    }
    res.json({ invoice, paymentUrl });
  } catch (value) { fail(res, value); }
});
router.post("/:id/void", requirePermission("invoices", "delete"), async (req, res): Promise<void> => { try { res.json(await voidInvoice(Number(req.params.id), String(req.body.reason ?? ""), getUser(req)!.id)); } catch (value) { fail(res, value); } });
router.all("/:id", (_req, res): void => { res.status(405).json({ error: "Invoices are immutable; use issue or void" }); });
export default router;