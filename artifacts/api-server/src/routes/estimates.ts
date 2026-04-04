import { Router } from "express";
import { db } from "@workspace/db";
import { estimatesTable, lineItemsTable, customersTable, vehiclesTable, invoicesTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";

const router: Router = Router();

function calcTotals(items: any[], taxRate: number, discount: number) {
  const subtotal = items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.unitPrice), 0);
  const taxAmount = subtotal * taxRate;
  const total = subtotal + taxAmount - discount;
  return { subtotal, taxAmount, total };
}

async function enrichEstimate(estimate: any) {
  const [lineItems, customer, vehicle] = await Promise.all([
    db.select().from(lineItemsTable).where(eq(lineItemsTable.estimateId, estimate.id)),
    db.select().from(customersTable).where(eq(customersTable.id, estimate.customerId)).then(r => r[0]),
    estimate.vehicleId ? db.select().from(vehiclesTable).where(eq(vehiclesTable.id, estimate.vehicleId)).then(r => r[0]) : Promise.resolve(null),
  ]);
  return { ...estimate, lineItems, customer, vehicle };
}

router.get("/", async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const status = req.query.status as string | undefined;
  const customerId = req.query.customerId ? Number(req.query.customerId) : undefined;
  const offset = (page - 1) * limit;

  const estimates = await (status
    ? db.select().from(estimatesTable).where(eq(estimatesTable.status, status)).orderBy(desc(estimatesTable.createdAt)).limit(limit).offset(offset)
    : db.select().from(estimatesTable).orderBy(desc(estimatesTable.createdAt)).limit(limit).offset(offset));
  const [countResult] = await db.select({ count: sql<number>`count(*)` }).from(estimatesTable);
  const enriched = await Promise.all(estimates.map(enrichEstimate));
  res.json({ data: enriched, total: Number(countResult.count), page, limit });
});

router.post("/", async (req, res) => {
  const [last] = await db.select({ estimateNumber: estimatesTable.estimateNumber }).from(estimatesTable).orderBy(desc(estimatesTable.id)).limit(1);
  const nextNum = last ? Number(last.estimateNumber.replace("EST-", "")) + 1 : 1001;
  const estimateNumber = `EST-${nextNum}`;

  const { customerId, vehicleId, status, notes, taxRate, discountAmount, lineItems } = req.body;
  const tax = taxRate ?? 0;
  const discount = discountAmount ?? 0;
  const { subtotal, taxAmount, total } = calcTotals(lineItems || [], tax, discount);

  const [estimate] = await db.insert(estimatesTable).values({
    estimateNumber, customerId, vehicleId, status: status || "draft", notes,
    taxRate: tax.toString(), taxAmount: taxAmount.toString(), discountAmount: discount.toString(),
    subtotal: subtotal.toString(), total: total.toString(),
  }).returning();

  if (lineItems?.length) {
    await db.insert(lineItemsTable).values(lineItems.map((item: any) => ({
      estimateId: estimate.id,
      type: item.type,
      description: item.description,
      quantity: item.quantity.toString(),
      unitPrice: item.unitPrice.toString(),
      total: (Number(item.quantity) * Number(item.unitPrice)).toString(),
      partNumber: item.partNumber,
      inventoryItemId: item.inventoryItemId,
    })));
  }

  res.status(201).json(await enrichEstimate(estimate));
});

router.get("/:id", async (req, res) => {
  const [estimate] = await db.select().from(estimatesTable).where(eq(estimatesTable.id, Number(req.params.id)));
  if (!estimate) return res.status(404).json({ error: "Estimate not found" });
  res.json(await enrichEstimate(estimate));
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { customerId, vehicleId, status, notes, taxRate, discountAmount, lineItems } = req.body;
  const tax = taxRate ?? 0;
  const discount = discountAmount ?? 0;
  const { subtotal, taxAmount, total } = calcTotals(lineItems || [], tax, discount);

  const [estimate] = await db.update(estimatesTable).set({
    customerId, vehicleId, status, notes,
    taxRate: tax.toString(), taxAmount: taxAmount.toString(), discountAmount: discount.toString(),
    subtotal: subtotal.toString(), total: total.toString(), updatedAt: new Date(),
  }).where(eq(estimatesTable.id, id)).returning();
  if (!estimate) return res.status(404).json({ error: "Estimate not found" });

  if (lineItems) {
    await db.delete(lineItemsTable).where(eq(lineItemsTable.estimateId, id));
    if (lineItems.length) {
      await db.insert(lineItemsTable).values(lineItems.map((item: any) => ({
        estimateId: id,
        type: item.type,
        description: item.description,
        quantity: item.quantity.toString(),
        unitPrice: item.unitPrice.toString(),
        total: (Number(item.quantity) * Number(item.unitPrice)).toString(),
        partNumber: item.partNumber,
        inventoryItemId: item.inventoryItemId,
      })));
    }
  }

  res.json(await enrichEstimate(estimate));
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(lineItemsTable).where(eq(lineItemsTable.estimateId, id));
  await db.delete(estimatesTable).where(eq(estimatesTable.id, id));
  res.status(204).send();
});

router.post("/:id/convert", async (req, res) => {
  const id = Number(req.params.id);
  const [estimate] = await db.select().from(estimatesTable).where(eq(estimatesTable.id, id));
  if (!estimate) return res.status(404).json({ error: "Estimate not found" });
  const items = await db.select().from(lineItemsTable).where(eq(lineItemsTable.estimateId, id));

  const [lastInv] = await db.select({ invoiceNumber: invoicesTable.invoiceNumber }).from(invoicesTable).orderBy(desc(invoicesTable.id)).limit(1);
  const nextNum = lastInv ? Number(lastInv.invoiceNumber.replace("INV-", "")) + 1 : 1001;
  const invoiceNumber = `INV-${nextNum}`;

  const [invoice] = await db.insert(invoicesTable).values({
    invoiceNumber, customerId: estimate.customerId, vehicleId: estimate.vehicleId, estimateId: estimate.id,
    status: "draft", notes: estimate.notes,
    subtotal: estimate.subtotal, taxRate: estimate.taxRate, taxAmount: estimate.taxAmount,
    discountAmount: estimate.discountAmount, total: estimate.total,
    amountPaid: "0", balance: estimate.total,
  }).returning();

  if (items.length) {
    await db.insert(lineItemsTable).values(items.map((item) => ({
      invoiceId: invoice.id, type: item.type, description: item.description,
      quantity: item.quantity, unitPrice: item.unitPrice, total: item.total,
      partNumber: item.partNumber,
    })));
  }

  await db.update(estimatesTable).set({ status: "converted", updatedAt: new Date() }).where(eq(estimatesTable.id, id));

  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, invoice.customerId));
  const [vehicle] = invoice.vehicleId ? await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, invoice.vehicleId)) : [null];
  const lineItemsData = await db.select().from(lineItemsTable).where(eq(lineItemsTable.invoiceId, invoice.id));
  res.status(201).json({ ...invoice, lineItems: lineItemsData, payments: [], customer, vehicle });
});

export default router;
