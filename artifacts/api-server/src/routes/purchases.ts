import { Router } from "express";
import { db } from "@workspace/db";
import { purchasesTable, purchaseLineItemsTable, inventoryTable, usedCarsTable } from "@workspace/db";
import { eq, desc, ilike, or, sql } from "drizzle-orm";
import { applyStockMovement, reverseStockMovement, type DbExecutor } from "../lib/inventory.js";

const router: Router = Router();

async function enrichPurchase(purchase: any) {
  const lineItems = await db
    .select()
    .from(purchaseLineItemsTable)
    .where(eq(purchaseLineItemsTable.purchaseId, purchase.id));

  const enrichedItems = await Promise.all(
    lineItems.map(async (item) => {
      let linkedItem = null;
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

  return { ...purchase, lineItems: enrichedItems };
}

// GET /api/purchases
router.get("/", async (req, res) => {
  const search = req.query.search as string | undefined;
  const status = req.query.status as string | undefined;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Number(req.query.limit) || 50);
  const offset = (page - 1) * limit;

  let query = db.select().from(purchasesTable);
  if (search) {
    query = query.where(
      or(
        ilike(purchasesTable.supplier, `%${search}%`),
        ilike(purchasesTable.invoiceNumber, `%${search}%`)
      )
    ) as any;
  }
  if (status) {
    query = query.where(eq(purchasesTable.status, status)) as any;
  }

  const [purchases, [{ count }]] = await Promise.all([
    query.orderBy(desc(purchasesTable.purchaseDate)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(purchasesTable),
  ]);

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

// POST /api/purchases
router.post("/", async (req, res) => {
  const {
    supplier, supplierContact, supplierEmail, supplierPhone,
    invoiceNumber, amount, tax, shipping, status, purchaseDate, notes,
    invoiceFilePath, invoiceFileName, invoiceFileType,
    lineItems = [],
  } = req.body;

  // Wrap purchase row + line items + receive movements in one transaction
  // so a partial failure (e.g. movement write) cannot leave a half-saved
  // purchase whose retry would duplicate rows.
  let purchase: any;
  try {
    purchase = await db.transaction(async (tx) => {
      const [created] = await tx.insert(purchasesTable).values({
        supplier,
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
    supplier, supplierContact, supplierEmail, supplierPhone,
    invoiceNumber, amount, tax, shipping, status, purchaseDate, notes,
    invoiceFilePath, invoiceFileName, invoiceFileType,
    lineItems,
  } = req.body;

  let purchase: any | null = null;
  try {
    purchase = await db.transaction(async (tx) => {
      const [prev] = await tx.select({ status: purchasesTable.status })
        .from(purchasesTable).where(eq(purchasesTable.id, id));

      // Reverse existing receive movements before lines are deleted/rewritten
      // OR before status leaves received. Doing this for prior `received` is
      // safe (reverseStockMovement is a no-op when there is nothing to
      // reverse) and prevents double counts on re-saves while still received.
      const wasReceived = prev?.status === "received";
      const willStayReceived = (status ?? prev?.status) === "received";
      const lineItemsRewritten = Array.isArray(lineItems);
      if (wasReceived && (!willStayReceived || lineItemsRewritten)) {
        await reverseReceiveMovements(id, tx);
      }

      const [updated] = await tx.update(purchasesTable).set({
        supplier,
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

export default router;
