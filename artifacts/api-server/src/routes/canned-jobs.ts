import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { cannedJobsTable } from "@workspace/db";
import { eq, ilike, or, sql } from "drizzle-orm";
import { requirePermission } from "../lib/auth.js";

const router: IRouter = Router();

const ITEM_TYPES = new Set(["labor", "part", "fee", "discount"]);
type CannedItem = { type: string; description: string; quantity: number; unitPrice: number; warrantyMonths?: number | null; warrantyMiles?: number | null };

function parseOptInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
}

function validateBody(body: any): { ok: true; value: { name: string; category: string | null; description: string | null; estimatedHours: unknown; items: CannedItem[] } } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Body required" };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return { ok: false, error: "name required" };
  const itemsIn = Array.isArray(body.items) ? body.items : [];
  const items: CannedItem[] = [];
  for (const [i, it] of itemsIn.entries()) {
    if (!it || typeof it !== "object") return { ok: false, error: `items[${i}] invalid` };
    if (!ITEM_TYPES.has(it.type)) return { ok: false, error: `items[${i}].type invalid` };
    const desc = typeof it.description === "string" ? it.description.trim() : "";
    if (!desc) return { ok: false, error: `items[${i}].description required` };
    const qty = Number(it.quantity);
    const price = Number(it.unitPrice);
    if (!Number.isFinite(qty) || qty < 0) return { ok: false, error: `items[${i}].quantity invalid` };
    if (!Number.isFinite(price) || price < 0) return { ok: false, error: `items[${i}].unitPrice invalid` };
    items.push({
      type: it.type, description: desc, quantity: qty, unitPrice: price,
      warrantyMonths: parseOptInt(it.warrantyMonths),
      warrantyMiles: parseOptInt(it.warrantyMiles),
    });
  }
  return {
    ok: true,
    value: {
      name,
      category: typeof body.category === "string" && body.category.trim() ? body.category.trim() : null,
      description: typeof body.description === "string" && body.description ? body.description : null,
      estimatedHours: body.estimatedHours,
      items,
    },
  };
}

function parseId(v: unknown): number | null {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeHours(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : null;
}

router.get("/", requirePermission("canned_jobs", "view"), async (req, res) => {
  const search = String(req.query.search || "").trim();
  const rows = search
    ? await db
        .select()
        .from(cannedJobsTable)
        .where(or(ilike(cannedJobsTable.name, `%${search}%`), ilike(cannedJobsTable.category, `%${search}%`)))
        .orderBy(cannedJobsTable.name)
    : await db.select().from(cannedJobsTable).orderBy(cannedJobsTable.name);
  res.json(rows);
});

router.get("/:id", requirePermission("canned_jobs", "view"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const [row] = await db.select().from(cannedJobsTable).where(eq(cannedJobsTable.id, id));
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

router.post("/", requirePermission("canned_jobs", "create"), async (req, res) => {
  const parsed = validateBody(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const v = parsed.value;
  const [row] = await db
    .insert(cannedJobsTable)
    .values({
      name: v.name,
      category: v.category,
      description: v.description,
      estimatedHours: normalizeHours(v.estimatedHours),
      items: v.items as any,
    })
    .returning();
  res.status(201).json(row);
});

router.put("/:id", requirePermission("canned_jobs", "edit"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const parsed = validateBody(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const v = parsed.value;
  const [row] = await db
    .update(cannedJobsTable)
    .set({
      name: v.name,
      category: v.category,
      description: v.description,
      estimatedHours: normalizeHours(v.estimatedHours),
      items: v.items as any,
      updatedAt: sql`now()`,
    })
    .where(eq(cannedJobsTable.id, id))
    .returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

router.delete("/:id", requirePermission("canned_jobs", "delete"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  await db.delete(cannedJobsTable).where(eq(cannedJobsTable.id, id));
  res.status(204).send();
});

export default router;
