import { Router } from "express";
import { db } from "@workspace/db";
import { invoicesTable, lineItemsTable, paymentsTable, customersTable, vehiclesTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { sendTemplatedEmail } from "../lib/email.js";
import { applyStockMovement, reverseStockMovement, getInventoryUnitCost, type DbExecutor } from "../lib/inventory.js";

const CONSUMPTION_STATUSES = new Set(["sent", "paid"]);

async function applyInvoiceConsumption(invoiceId: number, executor: DbExecutor = db) {
  const items = await executor.select().from(lineItemsTable).where(eq(lineItemsTable.invoiceId, invoiceId));
  for (const li of items) {
    const invId = Number(li.inventoryItemId);
    if (!Number.isFinite(invId) || invId <= 0) continue;
    const qty = Math.round(Number(li.quantity));
    if (!Number.isFinite(qty) || qty === 0) continue;
    const unitCost = li.unitCost ?? await getInventoryUnitCost(invId, executor);
    await applyStockMovement({
      inventoryId: invId,
      delta: -qty,
      reason: "invoice_consumed",
      referenceTable: "invoices",
      referenceId: invoiceId,
      referenceLineId: li.id,
      unitCost,
    }, executor);
  }
}

async function reverseInvoiceConsumption(invoiceId: number, executor: DbExecutor = db) {
  const items = await executor.select().from(lineItemsTable).where(eq(lineItemsTable.invoiceId, invoiceId));
  for (const li of items) {
    const invId = Number(li.inventoryItemId);
    if (!Number.isFinite(invId) || invId <= 0) continue;
    await reverseStockMovement({
      inventoryId: invId,
      originalReason: "invoice_consumed",
      reverseReason: "invoice_unconsumed",
      referenceTable: "invoices",
      referenceId: invoiceId,
      referenceLineId: li.id,
    }, executor);
  }
}

const router: Router = Router();

function vehicleInfoStr(vehicle: any): string {
  if (!vehicle) return "Not specified";
  const base = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ");
  return base + (vehicle.licensePlate ? ` (${vehicle.licensePlate})` : "");
}

function customerName(customer: any): string {
  return `${customer?.firstName ?? ""} ${customer?.lastName ?? ""}`.trim() || "Customer";
}

async function maybeSendInvoiceEmail(prevStatus: string | null, invoice: any, req: any) {
  try {
    if (invoice.status !== "sent") return;
    if (prevStatus === "sent") return;
    const customer = invoice.customer;
    if (!customer?.email) {
      req.log?.info({ id: invoice.id }, "No customer email; skipping invoice email");
      return;
    }
    const result = await sendTemplatedEmail("invoice_sent", customer.email, {
      customerName: customerName(customer),
      customerEmail: customer.email,
      shopName: process.env.SHOP_NAME || "Our Shop",
      invoiceNumber: invoice.invoiceNumber,
      total: `$${Number(invoice.total).toFixed(2)}`,
      balance: `$${Number(invoice.balance).toFixed(2)}`,
      dueDate: invoice.dueDate || "On receipt",
      vehicleInfo: vehicleInfoStr(invoice.vehicle),
    });
    if (!result.ok) req.log?.warn({ err: result.error, id: invoice.id }, "Invoice email failed");
  } catch (err) {
    req.log?.error({ err }, "maybeSendInvoiceEmail crashed");
  }
}

async function enrichInvoice(invoice: any) {
  const [lineItems, payments, customer, vehicle] = await Promise.all([
    db.select().from(lineItemsTable).where(eq(lineItemsTable.invoiceId, invoice.id)),
    db.select().from(paymentsTable).where(eq(paymentsTable.invoiceId, invoice.id)),
    db.select().from(customersTable).where(eq(customersTable.id, invoice.customerId)).then(r => r[0]),
    invoice.vehicleId ? db.select().from(vehiclesTable).where(eq(vehiclesTable.id, invoice.vehicleId)).then(r => r[0]) : Promise.resolve(null),
  ]);
  return { ...invoice, lineItems, payments, customer, vehicle };
}

function calcTotals(items: any[], taxRate: number, discount: number) {
  const subtotal = items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.unitPrice), 0);
  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal + taxAmount - discount;
  return { subtotal, taxAmount, total };
}

router.get("/", async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const status = req.query.status as string | undefined;
  const offset = (page - 1) * limit;

  const invoices = await (status
    ? db.select().from(invoicesTable).where(eq(invoicesTable.status, status)).orderBy(desc(invoicesTable.createdAt)).limit(limit).offset(offset)
    : db.select().from(invoicesTable).orderBy(desc(invoicesTable.createdAt)).limit(limit).offset(offset));
  const [countResult] = await db.select({ count: sql<number>`count(*)` }).from(invoicesTable);
  const enriched = await Promise.all(invoices.map(enrichInvoice));
  res.json({ data: enriched, total: Number(countResult.count), page, limit });
});

router.post("/", async (req, res) => {
  const { customerId, vehicleId, repairOrderId, estimateId, status, notes, taxRate, discountAmount, dueDate, lineItems } = req.body;
  const tax = taxRate ?? 0;
  const discount = discountAmount ?? 0;
  const { subtotal, taxAmount, total } = calcTotals(lineItems || [], tax, discount);

  let invoice: any;
  try {
    invoice = await db.transaction(async (tx) => {
      const [last] = await tx.select({ invoiceNumber: invoicesTable.invoiceNumber }).from(invoicesTable).orderBy(desc(invoicesTable.id)).limit(1);
      const nextNum = last ? Number(last.invoiceNumber.replace("INV-", "")) + 1 : 1001;
      const invoiceNumber = `INV-${nextNum}`;

      const [created] = await tx.insert(invoicesTable).values({
        invoiceNumber, customerId, vehicleId, repairOrderId, estimateId, status: status || "draft", notes,
        taxRate: tax.toString(), taxAmount: taxAmount.toString(), discountAmount: discount.toString(),
        subtotal: subtotal.toString(), total: total.toString(), amountPaid: "0", balance: total.toString(),
        dueDate,
      }).returning();

      if (lineItems?.length) {
        await tx.insert(lineItemsTable).values(lineItems.map((item: any) => ({
          invoiceId: created.id,
          type: item.type,
          description: item.description,
          quantity: item.quantity.toString(),
          unitPrice: item.unitPrice.toString(),
          total: (Number(item.quantity) * Number(item.unitPrice)).toString(),
          partNumber: item.partNumber,
          inventoryItemId: item.inventoryItemId ?? null,
          unitCost: item.unitCost != null ? String(item.unitCost) : null,
        })));
      }

      if (CONSUMPTION_STATUSES.has(created.status)) {
        await applyInvoiceConsumption(created.id, tx);
      }

      return created;
    });
  } catch (err) {
    req.log?.error({ err }, "Invoice create transaction failed");
    return res.status(500).json({ error: "Failed to create invoice" });
  }

  const enriched = await enrichInvoice(invoice);
  await maybeSendInvoiceEmail(null, enriched, req);
  res.status(201).json(enriched);
});

router.get("/:id", async (req, res) => {
  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, Number(req.params.id)));
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  res.json(await enrichInvoice(invoice));
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { customerId, vehicleId, status, notes, taxRate, discountAmount, dueDate, lineItems } = req.body;
  const tax = taxRate ?? 0;
  const discount = discountAmount ?? 0;
  const { subtotal, taxAmount, total } = calcTotals(lineItems || [], tax, discount);

  type Result =
    | { kind: "ok"; invoice: any; prevStatus: string | null }
    | { kind: "error"; status: number; error: string };

  let result: Result;
  try {
    result = await db.transaction(async (tx): Promise<Result> => {
      const [prev] = await tx.select({ status: invoicesTable.status }).from(invoicesTable).where(eq(invoicesTable.id, id));
      const existingPayments = await tx.select().from(paymentsTable).where(eq(paymentsTable.invoiceId, id));
      const amountPaid = existingPayments.reduce((sum, p) => sum + Number(p.amount), 0);
      const balance = total - amountPaid;

      const [invoice] = await tx.update(invoicesTable).set({
        customerId, vehicleId, status, notes,
        taxRate: tax.toString(), taxAmount: taxAmount.toString(), discountAmount: discount.toString(),
        subtotal: subtotal.toString(), total: total.toString(), amountPaid: amountPaid.toString(), balance: balance.toString(),
        dueDate, updatedAt: new Date(),
      }).where(eq(invoicesTable.id, id)).returning();
      if (!invoice) return { kind: "error", status: 404, error: "Invoice not found" };

      const wasConsumed = prev && CONSUMPTION_STATUSES.has(prev.status);
      const isConsumed = CONSUMPTION_STATUSES.has(invoice.status);

      if (lineItems) {
        if (wasConsumed) await reverseInvoiceConsumption(id, tx);
        await tx.delete(lineItemsTable).where(eq(lineItemsTable.invoiceId, id));
        if (lineItems.length) {
          await tx.insert(lineItemsTable).values(lineItems.map((item: any) => ({
            invoiceId: id, type: item.type, description: item.description,
            quantity: item.quantity.toString(), unitPrice: item.unitPrice.toString(),
            total: (Number(item.quantity) * Number(item.unitPrice)).toString(), partNumber: item.partNumber,
            inventoryItemId: item.inventoryItemId ?? null,
            unitCost: item.unitCost != null ? String(item.unitCost) : null,
          })));
        }
        if (isConsumed) await applyInvoiceConsumption(id, tx);
      } else {
        if (!wasConsumed && isConsumed) await applyInvoiceConsumption(id, tx);
        else if (wasConsumed && !isConsumed) await reverseInvoiceConsumption(id, tx);
      }

      return { kind: "ok", invoice, prevStatus: prev?.status ?? null };
    });
  } catch (err) {
    req.log?.error({ err, id }, "Invoice update transaction failed");
    return res.status(500).json({ error: "Failed to update invoice" });
  }

  if (result.kind === "error") return res.status(result.status).json({ error: result.error });

  const enriched = await enrichInvoice(result.invoice);
  await maybeSendInvoiceEmail(result.prevStatus, enriched, req);
  res.json(enriched);
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    await db.transaction(async (tx) => {
      await reverseInvoiceConsumption(id, tx);
      await tx.delete(lineItemsTable).where(eq(lineItemsTable.invoiceId, id));
      await tx.delete(paymentsTable).where(eq(paymentsTable.invoiceId, id));
      await tx.delete(invoicesTable).where(eq(invoicesTable.id, id));
    });
  } catch (err) {
    req.log?.error({ err, id }, "Invoice delete transaction failed");
    return res.status(500).json({ error: "Failed to delete invoice" });
  }
  res.status(204).send();
});

export default router;
