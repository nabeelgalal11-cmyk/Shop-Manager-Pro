import { Router, type IRouter } from "express";
import { db, estimateRevisionsTable, repairOrdersTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { getUser, requirePermission } from "../lib/auth.js";
import {
  WorkflowError, completeRepairOrder, createFinalInvoice, createRepairOrder,
  createRevision, getRepairOrderWorkflow, performWorkItem, cancelRepairOrder,
  replaceDraftItems, sendRevision, updateIntake,
} from "../lib/repair-workflow.js";

const router: IRouter = Router();
const id = (raw: string | string[] | undefined) => Number(Array.isArray(raw) ? raw[0] : raw);
const sendError = (res: any, error: unknown) => {
  if (error instanceof WorkflowError) { res.status(error.status).json({ error: error.message }); return; }
  throw error;
};
const canOperate = (req: any, assignedToId: number | null) => {
  const user = getUser(req);
  return !!user && (user.roles.includes("admin") || user.roles.includes("manager") || assignedToId === user.id);
};
const hasManagerOverride = (req: any) => {
  const user = getUser(req);
  return !!user && (user.roles.includes("admin") || user.roles.includes("manager"));
};
/** Commercial access is aggregate-scoped. Missing and unauthorized IDs both
 * return the same 403 so guessed cross-aggregate identifiers disclose nothing. */
async function requireCommercialRoAccess(req: any, repairOrderId: number) {
  const user = getUser(req);
  if (!user) throw new WorkflowError("Commercial repair order access denied", 403);
  const [ro] = await db.select({ id: repairOrdersTable.id, createdById: repairOrdersTable.createdById })
    .from(repairOrdersTable).where(eq(repairOrdersTable.id, repairOrderId));
  if (!ro || (!hasManagerOverride(req) && (!user.roles.includes("advisor") || ro.createdById !== user.id))) {
    throw new WorkflowError("Commercial repair order access denied", 403);
  }
  return ro;
}
async function requireCommercialRevisionAccess(req: any, revisionId: number) {
  const [revision] = await db.select({ repairOrderId: estimateRevisionsTable.repairOrderId })
    .from(estimateRevisionsTable).where(eq(estimateRevisionsTable.id, revisionId));
  if (!revision) throw new WorkflowError("Commercial repair order access denied", 403);
  await requireCommercialRoAccess(req, revision.repairOrderId);
  return revision;
}

router.get("/", requirePermission("repair_orders", "view"), async (req, res): Promise<void> => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const orders = await db.select().from(repairOrdersTable).where(status ? eq(repairOrdersTable.status, status as any) : undefined).orderBy(desc(repairOrdersTable.openedAt));
  res.json(orders);
});
router.post("/", requirePermission("repair_orders", "create"), async (req, res): Promise<void> => {
  try { res.status(201).json(await createRepairOrder(req.body, getUser(req)!.id)); } catch (error) { sendError(res, error); }
});
router.get("/:id", requirePermission("repair_orders", "view"), async (req, res): Promise<void> => {
  try { res.json(await getRepairOrderWorkflow(id(req.params.id))); } catch (error) { sendError(res, error); }
});
router.patch("/:id/intake", requirePermission("repair_orders", "edit"), async (req, res): Promise<void> => {
  try {
    const workflow = await getRepairOrderWorkflow(id(req.params.id));
    if (!canOperate(req, workflow.repairOrder.assignedToId)) throw new WorkflowError("Only the assigned technician or manager may update this repair order", 403);
    res.json(await updateIntake(workflow.repairOrder.id, Number(req.body.version), req.body, getUser(req)!.id));
  } catch (error) { sendError(res, error); }
});
router.post("/:id/revisions", requirePermission("estimates", "create"), async (req, res): Promise<void> => {
  try {
    const user = getUser(req)!;
    if (!user.roles.some((role) => role === "manager" || role === "admin" || role === "advisor")) throw new WorkflowError("Only advisors or managers may create revisions", 403);
    const repairOrderId = id(req.params.id);
    await requireCommercialRoAccess(req, repairOrderId);
    res.status(201).json(await createRevision(repairOrderId, req.body.kind === "supplement" ? "supplement" : "estimate", user.id, Number(req.body.taxRateBps ?? 0)));
  } catch (error) { sendError(res, error); }
});
router.put("/revisions/:revisionId/items", requirePermission("estimates", "edit"), async (req, res): Promise<void> => {
  try {
    const user = getUser(req)!;
    if (!user.roles.some((role) => ["admin", "manager", "advisor"].includes(role))) throw new WorkflowError("Only advisors or managers may edit revisions", 403);
    const revisionId = id(req.params.revisionId);
    await requireCommercialRevisionAccess(req, revisionId);
    res.json(await replaceDraftItems(revisionId, req.body.items ?? [], user.id));
  } catch (error) { sendError(res, error); }
});
router.post("/revisions/:revisionId/send", requirePermission("estimates", "edit"), async (req, res): Promise<void> => {
  try {
    const user = getUser(req)!;
    if (!user.roles.some((role) => ["admin", "manager", "advisor"].includes(role))) throw new WorkflowError("Only advisors or managers may send revisions", 403);
    const revisionId = id(req.params.revisionId);
    await requireCommercialRevisionAccess(req, revisionId);
    res.json(await sendRevision(revisionId, user.id));
  } catch (error) { sendError(res, error); }
});
router.post("/work-items/:workItemId/perform", requirePermission("repair_orders", "edit"), async (req, res): Promise<void> => {
  try {
    const user = getUser(req)!;
    res.json(await performWorkItem(id(req.params.workItemId), user.id, user.roles.includes("admin") || user.roles.includes("manager")));
  } catch (error) { sendError(res, error); }
});
router.post("/:id/complete", requirePermission("repair_orders", "edit"), async (req, res): Promise<void> => {
  try {
    const user = getUser(req)!;
    if (!user.roles.some((role) => role === "admin" || role === "manager")) throw new WorkflowError("Only managers may complete repair orders", 403);
    res.json(await completeRepairOrder(id(req.params.id), user.id));
  } catch (error) { sendError(res, error); }
});
router.post("/:id/cancel", requirePermission("repair_orders", "delete"), async (req, res): Promise<void> => {
  try {
    const user = getUser(req)!;
    if (!user.roles.some((role) => role === "admin" || role === "manager")) throw new WorkflowError("Only managers may cancel repair orders", 403);
    res.json(await cancelRepairOrder(id(req.params.id), String(req.body.reason ?? ""), user.id));
  } catch (error) { sendError(res, error); }
});
router.post("/:id/invoice", requirePermission("invoices", "create"), async (req, res): Promise<void> => {
  try {
    const user = getUser(req)!;
    if (!user.roles.some((role) => ["admin", "manager", "finance"].includes(role))) throw new WorkflowError("Only finance or managers may create final invoices", 403);
    // Resolve the aggregate before mutation so guessed IDs cannot bypass the
    // commercial role/object gate.
    await getRepairOrderWorkflow(id(req.params.id));
    res.status(201).json(await createFinalInvoice(id(req.params.id), user.id));
  } catch (error) { sendError(res, error); }
});
router.all("/:id", (_req, res): void => { res.status(405).json({ error: "Use explicit repair-order workflow actions" }); });
export default router;