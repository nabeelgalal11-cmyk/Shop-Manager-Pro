import { Router } from "express";
import { db } from "@workspace/db";
import {
  suppliersTable,
  purchasesTable,
  inventoryTable,
} from "@workspace/db";
import { and, eq, ilike, or, sql, desc } from "drizzle-orm";
import { requirePermission } from "../lib/auth.js";
import { recordActivity } from "../lib/activity.js";

const router: Router = Router();

// GET /api/suppliers — list (search + archived filter)
router.get("/", requirePermission("suppliers", "view"), async (req, res) => {
  const search = (req.query.search as string | undefined)?.trim();
  const includeArchived = req.query.includeArchived === "true";
  const limit = Math.min(200, Number(req.query.limit) || 100);

  const filters = [] as ReturnType<typeof eq>[];
  if (!includeArchived) filters.push(eq(suppliersTable.archived, false));
  if (search) {
    filters.push(
      or(
        ilike(suppliersTable.name, `%${search}%`),
        ilike(suppliersTable.contactName, `%${search}%`),
        ilike(suppliersTable.contactEmail, `%${search}%`),
        ilike(suppliersTable.accountNumber, `%${search}%`),
      )!,
    );
  }

  const rows = await db
    .select({
      id: suppliersTable.id,
      name: suppliersTable.name,
      accountNumber: suppliersTable.accountNumber,
      paymentTerms: suppliersTable.paymentTerms,
      contactName: suppliersTable.contactName,
      contactEmail: suppliersTable.contactEmail,
      contactPhone: suppliersTable.contactPhone,
      address: suppliersTable.address,
      notes: suppliersTable.notes,
      archived: suppliersTable.archived,
      createdAt: suppliersTable.createdAt,
      updatedAt: suppliersTable.updatedAt,
      purchaseCount: sql<number>`(select count(*)::int from purchases where supplier_id = ${suppliersTable.id})`,
      inventoryCount: sql<number>`(select count(*)::int from inventory where preferred_supplier_id = ${suppliersTable.id})`,
      totalSpend: sql<number>`(select coalesce(sum(amount + coalesce(tax,0) + coalesce(shipping,0)), 0)::numeric from purchases where supplier_id = ${suppliersTable.id})`,
    })
    .from(suppliersTable)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(suppliersTable.name)
    .limit(limit);

  res.json({
    data: rows.map((r) => ({
      ...r,
      purchaseCount: Number(r.purchaseCount),
      inventoryCount: Number(r.inventoryCount),
      totalSpend: Number(r.totalSpend),
    })),
  });
});

// GET /api/suppliers/:id — detail with recent purchases + linked inventory
router.get("/:id", requirePermission("suppliers", "view"), async (req, res) => {
  const id = Number(req.params.id);
  const [supplier] = await db.select().from(suppliersTable).where(eq(suppliersTable.id, id));
  if (!supplier) return res.status(404).json({ error: "Supplier not found" });

  const [recentPurchases, linkedInventory, [stats], [invCount]] = await Promise.all([
    db
      .select({
        id: purchasesTable.id,
        invoiceNumber: purchasesTable.invoiceNumber,
        amount: purchasesTable.amount,
        tax: purchasesTable.tax,
        shipping: purchasesTable.shipping,
        status: purchasesTable.status,
        purchaseDate: purchasesTable.purchaseDate,
      })
      .from(purchasesTable)
      .where(eq(purchasesTable.supplierId, id))
      .orderBy(desc(purchasesTable.purchaseDate))
      .limit(20),
    db
      .select({
        id: inventoryTable.id,
        partNumber: inventoryTable.partNumber,
        name: inventoryTable.name,
        category: inventoryTable.category,
        quantity: inventoryTable.quantity,
        minQuantity: inventoryTable.minQuantity,
        costPrice: inventoryTable.costPrice,
      })
      .from(inventoryTable)
      .where(eq(inventoryTable.preferredSupplierId, id))
      .orderBy(inventoryTable.name)
      .limit(200),
    db
      .select({
        purchaseCount: sql<number>`count(*)::int`,
        totalSpend: sql<number>`coalesce(sum(amount + coalesce(tax,0) + coalesce(shipping,0)), 0)::numeric`,
        lastPurchaseDate: sql<string | null>`max(purchase_date)`,
      })
      .from(purchasesTable)
      .where(eq(purchasesTable.supplierId, id)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(inventoryTable)
      .where(eq(inventoryTable.preferredSupplierId, id)),
  ]);

  res.json({
    ...supplier,
    recentPurchases,
    linkedInventory,
    stats: {
      purchaseCount: Number(stats.purchaseCount),
      totalSpend: Number(stats.totalSpend),
      inventoryCount: Number(invCount?.count ?? 0),
      lastPurchaseDate: stats.lastPurchaseDate,
    },
  });
});

// POST /api/suppliers — create
router.post("/", requirePermission("suppliers", "create"), async (req, res) => {
  const { name, accountNumber, paymentTerms, contactName, contactEmail, contactPhone, address, notes, archived } = req.body;
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: "Name is required" });
  }
  try {
    const [supplier] = await db
      .insert(suppliersTable)
      .values({
        name: String(name).trim(),
        accountNumber: accountNumber || null,
        paymentTerms: paymentTerms || null,
        contactName: contactName || null,
        contactEmail: contactEmail || null,
        contactPhone: contactPhone || null,
        address: address || null,
        notes: notes || null,
        archived: Boolean(archived),
      })
      .returning();
    await recordActivity({
      entityType: "supplier",
      entityId: supplier.id,
      eventType: "created",
      meta: { name: supplier.name },
      req,
    });
    res.status(201).json(supplier);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("suppliers_name_lower_unique")) {
      return res.status(409).json({ error: "A supplier with that name already exists" });
    }
    req.log?.error({ err }, "Supplier create failed");
    res.status(500).json({ error: "Failed to create supplier" });
  }
});

// PUT /api/suppliers/:id
router.put("/:id", requirePermission("suppliers", "edit"), async (req, res) => {
  const id = Number(req.params.id);
  const { name, accountNumber, paymentTerms, contactName, contactEmail, contactPhone, address, notes, archived } = req.body;
  try {
    const [supplier] = await db
      .update(suppliersTable)
      .set({
        ...(name !== undefined && { name: String(name).trim() }),
        ...(accountNumber !== undefined && { accountNumber: accountNumber || null }),
        ...(paymentTerms !== undefined && { paymentTerms: paymentTerms || null }),
        ...(contactName !== undefined && { contactName: contactName || null }),
        ...(contactEmail !== undefined && { contactEmail: contactEmail || null }),
        ...(contactPhone !== undefined && { contactPhone: contactPhone || null }),
        ...(address !== undefined && { address: address || null }),
        ...(notes !== undefined && { notes: notes || null }),
        ...(archived !== undefined && { archived: Boolean(archived) }),
        updatedAt: new Date(),
      })
      .where(eq(suppliersTable.id, id))
      .returning();
    if (!supplier) return res.status(404).json({ error: "Supplier not found" });
    await recordActivity({
      entityType: "supplier",
      entityId: supplier.id,
      eventType: "updated",
      meta: { name: supplier.name },
      req,
    });
    res.json(supplier);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("suppliers_name_lower_unique")) {
      return res.status(409).json({ error: "A supplier with that name already exists" });
    }
    req.log?.error({ err, id }, "Supplier update failed");
    res.status(500).json({ error: "Failed to update supplier" });
  }
});

// DELETE /api/suppliers/:id — hard delete only when nothing references it.
// Otherwise the client should archive instead.
router.delete("/:id", requirePermission("suppliers", "delete"), async (req, res) => {
  const id = Number(req.params.id);
  const [refs] = await db
    .select({
      purchases: sql<number>`(select count(*)::int from purchases where supplier_id = ${id})`,
      inventory: sql<number>`(select count(*)::int from inventory where preferred_supplier_id = ${id})`,
    })
    .from(sql`(select 1) _`);
  if (Number(refs.purchases) > 0 || Number(refs.inventory) > 0) {
    return res.status(409).json({
      error: "Supplier is referenced by purchases or inventory items. Archive it instead.",
      purchaseCount: Number(refs.purchases),
      inventoryCount: Number(refs.inventory),
    });
  }
  const [deleted] = await db.delete(suppliersTable).where(eq(suppliersTable.id, id)).returning();
  if (!deleted) return res.status(404).json({ error: "Supplier not found" });
  await recordActivity({
    entityType: "supplier",
    entityId: id,
    eventType: "deleted",
    meta: { name: deleted.name },
    req,
  });
  res.status(204).send();
});

export default router;
