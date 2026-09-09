import { Router, type IRouter } from "express";
import { db, estimateItemsTable, estimateRevisionsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { requirePermission } from "../lib/auth.js";
const router: IRouter = Router();
router.get("/", requirePermission("estimates", "view"), async (req, res): Promise<void> => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  res.json(await db.select().from(estimateRevisionsTable).orderBy(desc(estimateRevisionsTable.createdAt)).limit(limit));
});
router.get("/:id", requirePermission("estimates", "view"), async (req, res): Promise<void> => {
  const [revision] = await db.select().from(estimateRevisionsTable).where(eq(estimateRevisionsTable.id, Number(req.params.id)));
  if (!revision) { res.status(404).json({ error: "Estimate revision not found" }); return; }
  res.json({ ...revision, items: await db.select().from(estimateItemsTable).where(eq(estimateItemsTable.estimateRevisionId, revision.id)) });
});
router.all("/:id", (_req, res): void => { res.status(405).json({ error: "Use repair-order revision workflow actions" }); });
export default router;