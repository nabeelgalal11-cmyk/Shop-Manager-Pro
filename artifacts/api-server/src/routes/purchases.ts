import { Router } from "express";
import { db } from "@workspace/db";
import {
  purchasesTable,
  purchaseLineItemsTable,
  inventoryTable,
  usedCarsTable,
  suppliersTable,
} from "@workspace/db";
import { eq, desc, ilike, or, sql, and, inArray } from "drizzle-orm";
import { applyStockMovement, reverseStockMovement, type DbExecutor } from "../lib/inventory.js";
import { recordActivity } from "../lib/activity.js";
import { requirePermission } from "../lib/auth.js";

const router: Router = Router();

async function enrichPurchase(purchase: any) {
  const lineItems = await db
    .select()
    .from(purchaseLineItemsTable)
    .where(eq(purchaseLineItemsTable.purchaseId, purchase.id));

  const enrichedItems = await Promise.all(
    lineItems.map(async (item) => {
      let linkedItem: unknown = null;
      if (item.itemType === "inventory" && item.inventoryId) {
        const [inv] = await db.select().from(inventoryTable).where(eq(inventoryTable.id, item.inventoryId));
        linkedItem = inv;
      } else if (item.itemType === "used_car" && item.usedCarId) {
        const [car] = await db.select().from(usedCarsTable).where(eq(usedCarsTable.id, item.usedCarId));
        linkedItem = car;
      }
      return { ...item, linkedItem };
    })
  );

  let supplier: { id: number; name: string } | null = null;
  if (purchase.supplierId) {
    const [s] = await db
      .select({ id: suppliersTable.id, name: suppliersTable.name })
      .from(suppliersTable)
      .where(eq(suppliersTable.id, purchase.supplierId));
    if (s) supplier = s;
  }

  // For UI convenience expose a single `supplier` display name regardless
  // of whether the legacy text or new FK is populated.
  const supplierName = supplier?.name ?? purchase.supplierLegacy ?? null;

  return { ...purchase, supplier: supplierName, supplierRecord: supplier, lineItems: enrichedItems };
}

// GET /api/purchases
router.get("/", async (req, res) => {
  const search = req.query.search as string | undefined;
  const status = req.query.status as string | undefined;
  const supplierIdParam = req.query.supplierId ? Number(req.query.supplierId) : null;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Number(req.query.limit) || 50);
  const offset = (page - 1) * limit;

  const filters: any[] = [];
  if (search) {
    filters.push(
      or(
        ilike(purchasesTable.supplierLegacy, `%${search}%`),
        ilike(purchasesTable.invoiceNumber, `%${search}%`),
        sql`exists (select 1 from suppliers s where s.id = ${purchasesTable.supplierId} and s.name ilike ${"%" + search + "%"})`,
      ),
    );
  }
  if (status) filters.push(eq(purchasesTable.status, status));
  if (supplierIdParam) filters.push(eq(purchasesTable.supplierId, supplierIdParam));

  const where = filters.length > 0 ? and(...filters) : undefined;

  const [rows, [{ count }]] = await Promise.all([
    db
      .select({
        id: purchasesTable.id,
        supplierId: purchasesTable.supplierId,
        supplierLegacy: purchasesTable.supplierLegacy,
        supplierName: suppliersTable.name,
        supplierContact: purchasesTable.supplierContact,
        supplierEmail: purchasesTable.supplierEmail,
        supplierPhone: purchasesTable.supplierPhone,
        invoiceNumber: purchasesTable.invoiceNumber,
        amount: purchasesTable.amount,
        tax: purchasesTable.tax,
        shipping: purchasesTable.shipping,
        status: purchasesTable.status,
        purchaseDate: purchasesTable.purchaseDate,
        notes: purchasesTable.notes,
        invoiceFilePath: purchasesTable.invoiceFilePath,
        invoiceFileName: purchasesTable.invoiceFileName,
        invoiceFileType: purchasesTable.invoiceFileType,
        createdAt: purchasesTable.createdAt,
        updatedAt: purchasesTable.updatedAt,
      })
      .from(purchasesTable)
      .leftJoin(suppliersTable, eq(suppliersTable.id, purchasesTable.supplierId))
      .where(where)
      .orderBy(desc(purchasesTable.purchaseDate))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(purchasesTable).where(where),
  ]);

  const purchases = rows.map((r) => ({
    ...r,
    supplier: r.supplierName ?? r.supplierLegacy ?? "",
  }));

  const [stats] = await db.select({
    totalAmount: sql<number>`coalesce(sum(amount), 0)::numeric`,
    totalTax: sql<number>`coalesce(sum(tax), 0)::numeric`,
    totalShipping: sql<number>`coalesce(sum(shipping), 0)::numeric`,
    pendingCount: sql<number>`sum(case when status = 'pending' then 1 else 0 end)::int`,
    receivedCount: sql<number>`sum(case when status = 'received' then 1 else 0 end)::int`,
    totalCount: sql<number>`count(*)::int`,
  }).from(purchasesTable);

  res.json({
    data: purchases,
    total: Number(count),
    page,
    limit,
    stats: {
      totalAmount: Number(stats.totalAmount),
      totalTax: Number(stats.totalTax),
      totalShipping: Number(stats.totalShipping),
      pendingCount: Number(stats.pendingCount),
      receivedCount: Number(stats.receivedCount),
      totalCount: Number(stats.totalCount),
    }
  });
});

async function resolveSupplierId(input: {
  supplierId?: number | null;
  supplierName?: string | null;
}): Promise<number | null> {
  if (input.supplierId) return Number(input.supplierId);
  const name = input.supplierName?.trim();
  if (!name) return null;
  // Find or create by case-insensitive name. Used when the form types a
  // free-text supplier instead of picking from the dropdown.
  const [existing] = await db
    .select({ id: suppliersTable.id })
    .from(suppliersTable)
    .where(sql`lower(${suppliersTable.name}) = lower(${name})`);
  if (existing) return existing.id;
  const [created] = await db.insert(suppliersTable).values({ name }).returning({ id: suppliersTable.id });
  return created.id;
}

// POST /api/purchases
router.post("/", async (req, res) => {
  const {
    supplierId: supplierIdRaw, supplier: supplierName,
    supplierContact, supplierEmail, supplierPhone,
    invoiceNumber, amount, tax, shipping, status, purchaseDate, notes,
    invoiceFilePath, invoiceFileName, invoiceFileType,
    lineItems = [],
  } = req.body;

  const supplierId = await resolveSupplierId({ supplierId: supplierIdRaw, supplierName });
  if (!supplierId) return res.status(400).json({ error: "Supplier is required" });

  let purchase: any;
  try {
    purchase = await db.transaction(async (tx) => {
      const [created] = await tx.insert(purchasesTable).values({
        supplierId,
        supplierContact,
        supplierEmail,
        supplierPhone,
        invoiceNumber,
        amount: String(amount || 0),
        tax: String(tax || 0),
        shipping: String(shipping || 0),
        status: status || "pending",
        purchaseDate,
        notes,
        invoiceFilePath,
        invoiceFileName,
        invoiceFileType,
      }).returning();

      if (lineItems.length > 0) {
        await tx.insert(purchaseLineItemsTable).values(
          lineItems.map((item: any) => ({
            purchaseId: created.id,
            itemType: item.itemType || "other",
            inventoryId: item.inventoryId || null,
            usedCarId: item.usedCarId || null,
            description: item.description,
            quantity: String(item.quantity || 1),
            unitCost: String(item.unitCost || 0),
            notes: item.notes || null,
          }))
        );
      }

      await applyReceiveMovements(created.id, created.status, tx);
      return created;
    });
  } catch (err) {
    req.log?.error({ err }, "Purchase create transaction failed");
    return res.status(500).json({ error: "Failed to create purchase" });
  }

  await recordActivity({
    entityType: "purchase",
    entityId: purchase.id,
    eventType: "created",
    meta: { supplierId, status: purchase.status, amount: purchase.amount },
    req,
  });

  res.status(201).json(await enrichPurchase(purchase));
});

async function applyReceiveMovements(purchaseId: number, status: string, executor: DbExecutor = db) {
  if (status !== "received") return;
  const items = await executor.select().from(purchaseLineItemsTable)
    .where(eq(purchaseLineItemsTable.purchaseId, purchaseId));
  for (const item of items) {
    if (item.itemType !== "inventory" || !item.inventoryId) continue;
    const qty = Math.round(Number(item.quantity));
    if (!Number.isFinite(qty) || qty === 0) continue;
    await applyStockMovement({
      inventoryId: item.inventoryId,
      delta: qty,
      reason: "purchase_received",
      referenceTable: "purchases",
      referenceId: purchaseId,
      referenceLineId: item.id,
      unitCost: item.unitCost,
    }, executor);
  }
}

async function reverseReceiveMovements(purchaseId: number, executor: DbExecutor = db) {
  const items = await executor.select().from(purchaseLineItemsTable)
    .where(eq(purchaseLineItemsTable.purchaseId, purchaseId));
  for (const item of items) {
    if (item.itemType !== "inventory" || !item.inventoryId) continue;
    await reverseStockMovement({
      inventoryId: item.inventoryId,
      originalReason: "purchase_received",
      reverseReason: "purchase_unreceived",
      referenceTable: "purchases",
      referenceId: purchaseId,
      referenceLineId: item.id,
    }, executor);
  }
}

// GET /api/purchases/:id
router.get("/:id", async (req, res) => {
  const [purchase] = await db.select().from(purchasesTable).where(eq(purchasesTable.id, Number(req.params.id)));
  if (!purchase) return res.status(404).json({ error: "Purchase not found" });
  res.json(await enrichPurchase(purchase));
});

// PUT /api/purchases/:id
router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const {
    supplierId: supplierIdRaw, supplier: supplierName,
    supplierContact, supplierEmail, supplierPhone,
    invoiceNumber, amount, tax, shipping, status, purchaseDate, notes,
    invoiceFilePath, invoiceFileName, invoiceFileType,
    lineItems,
  } = req.body;

  const supplierId =
    supplierIdRaw === undefined && supplierName === undefined
      ? undefined
      : await resolveSupplierId({ supplierId: supplierIdRaw, supplierName });
  if (supplierId === null) {
    return res.status(400).json({ error: "Supplier is required" });
  }

  let purchase: any | null = null;
  try {
    purchase = await db.transaction(async (tx) => {
      const [prev] = await tx.select({ status: purchasesTable.status })
        .from(purchasesTable).where(eq(purchasesTable.id, id));

      const wasReceived = prev?.status === "received";
      const willStayReceived = (status ?? prev?.status) === "received";
      const lineItemsRewritten = Array.isArray(lineItems);
      if (wasReceived && (!willStayReceived || lineItemsRewritten)) {
        await reverseReceiveMovements(id, tx);
      }

      const [updated] = await tx.update(purchasesTable).set({
        ...(supplierId !== undefined && { supplierId }),
        supplierContact,
        supplierEmail,
        supplierPhone,
        invoiceNumber,
        amount: String(amount),
        tax: String(tax || 0),
        shipping: String(shipping || 0),
        status,
        purchaseDate,
        notes,
        invoiceFilePath,
        invoiceFileName,
        invoiceFileType,
        updatedAt: new Date(),
      }).where(eq(purchasesTable.id, id)).returning();

      if (!updated) return null;

      if (Array.isArray(lineItems)) {
        await tx.delete(purchaseLineItemsTable).where(eq(purchaseLineItemsTable.purchaseId, id));
        if (lineItems.length > 0) {
          await tx.insert(purchaseLineItemsTable).values(
            lineItems.map((item: any) => ({
              purchaseId: id,
              itemType: item.itemType || "other",
              inventoryId: item.inventoryId || null,
              usedCarId: item.usedCarId || null,
              description: item.description,
              quantity: String(item.quantity || 1),
              unitCost: String(item.unitCost || 0),
              notes: item.notes || null,
            }))
          );
        }
      }

      if (updated.status === "received") {
        await applyReceiveMovements(id, updated.status, tx);
      }

      return updated;
    });
  } catch (err) {
    req.log?.error({ err, id }, "Purchase update transaction failed");
    return res.status(500).json({ error: "Failed to update purchase" });
  }

  if (!purchase) return res.status(404).json({ error: "Purchase not found" });
  await recordActivity({
    entityType: "purchase",
    entityId: id,
    eventType: status !== undefined ? "status_changed" : "updated",
    meta: { status: purchase.status },
    req,
  });
  res.json(await enrichPurchase(purchase));
});

// DELETE /api/purchases/:id
router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    await db.transaction(async (tx) => {
      await reverseReceiveMovements(id, tx);
      await tx.delete(purchasesTable).where(eq(purchasesTable.id, id));
    });
  } catch (err) {
    req.log?.error({ err, id }, "Purchase delete transaction failed");
    return res.status(500).json({ error: "Failed to delete purchase" });
  }
  await recordActivity({
    entityType: "purchase",
    entityId: id,
    eventType: "deleted",
    req,
  });
  res.status(204).send();
});

// PATCH /api/purchases/:id/invoice — store object path after upload
router.patch("/:id/invoice", async (req, res) => {
  const id = Number(req.params.id);
  const { invoiceFilePath, invoiceFileName, invoiceFileType } = req.body;
  const [purchase] = await db.update(purchasesTable)
    .set({ invoiceFilePath, invoiceFileName, invoiceFileType, updatedAt: new Date() })
    .where(eq(purchasesTable.id, id))
    .returning();
  if (!purchase) return res.status(404).json({ error: "Purchase not found" });
  res.json(purchase);
});

// POST /api/purchases/from-reorder — create a draft purchase for one supplier
// from a list of inventory items (qty defaults to minQuantity - quantity).
router.post("/from-reorder", requirePermission("purchases", "create"), async (req, res) => {
  const supplierId = Number(req.body.supplierId);
  if (!supplierId) return res.status(400).json({ error: "supplierId is required" });
  const items: Array<{ inventoryId: number; quantity?: number }> = Array.isArray(req.body.items)
    ? req.body.items
    : [];
  if (items.length === 0) return res.status(400).json({ error: "items must not be empty" });

  const inventoryIds = items.map((i) => Number(i.inventoryId)).filter((n) => Number.isFinite(n));
  if (inventoryIds.length === 0) return res.status(400).json({ error: "no valid inventory ids" });

  const invRows = await db
    .select()
    .from(inventoryTable)
    .where(inArray(inventoryTable.id, inventoryIds));
  const invById = new Map(invRows.map((r) => [r.id, r]));

  const lineItems = items
    .map((it) => {
      const inv = invById.get(Number(it.inventoryId));
      if (!inv) return null;
      const requested = Number(it.quantity);
      const qty = Number.isFinite(requested) && requested > 0
        ? Math.round(requested)
        : Math.max(1, (inv.minQuantity ?? 0) - (inv.quantity ?? 0));
      return {
        itemType: "inventory" as const,
        inventoryId: inv.id,
        description: inv.name + (inv.partNumber ? ` (${inv.partNumber})` : ""),
        quantity: String(qty),
        unitCost: String(inv.costPrice ?? "0"),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (lineItems.length === 0) return res.status(400).json({ error: "no inventory items found" });

  const subtotal = lineItems.reduce(
    (s, l) => s + Number(l.quantity) * Number(l.unitCost),
    0,
  );

  const today = new Date().toISOString().slice(0, 10);
  let created: any;
  try {
    created = await db.transaction(async (tx) => {
      const [p] = await tx.insert(purchasesTable).values({
        supplierId,
        amount: subtotal.toFixed(2),
        status: "pending",
        purchaseDate: today,
        notes: "Created from reorder report",
      }).returning();
      await tx.insert(purchaseLineItemsTable).values(
        lineItems.map((li) => ({ purchaseId: p.id, ...li })),
      );
      return p;
    });
  } catch (err) {
    req.log?.error({ err }, "from-reorder create failed");
    return res.status(500).json({ error: "Failed to create draft purchase" });
  }

  await recordActivity({
    entityType: "purchase",
    entityId: created.id,
    eventType: "created",
    meta: { supplierId, source: "reorder", lineCount: lineItems.length },
    req,
  });
  res.status(201).json(await enrichPurchase(created));
});

export default router;
