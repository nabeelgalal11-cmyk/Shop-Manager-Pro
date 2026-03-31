import { Router } from "express";
import { db } from "@workspace/db";
import { customersTable, vehiclesTable, invoicesTable, paymentsTable } from "@workspace/db";
import { eq, ilike, or, sql, desc } from "drizzle-orm";

const router = Router();

router.get("/", async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const search = req.query.search as string | undefined;
  const offset = (page - 1) * limit;

  const whereClause = search
    ? or(
        ilike(customersTable.firstName, `%${search}%`),
        ilike(customersTable.lastName, `%${search}%`),
        ilike(customersTable.email, `%${search}%`),
        ilike(customersTable.phone, `%${search}%`)
      )
    : undefined;

  const [data, countResult] = await Promise.all([
    db.select().from(customersTable).where(whereClause).orderBy(desc(customersTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(customersTable).where(whereClause),
  ]);

  const enriched = await Promise.all(data.map(async (customer) => {
    const [vehicleCount] = await db.select({ count: sql<number>`count(*)` }).from(vehiclesTable).where(eq(vehiclesTable.customerId, customer.id));
    const invoices = await db.select({ total: invoicesTable.total, amountPaid: invoicesTable.amountPaid }).from(invoicesTable).where(eq(invoicesTable.customerId, customer.id));
    const totalBilled = invoices.reduce((sum, inv) => sum + Number(inv.total), 0);
    const totalPaid = invoices.reduce((sum, inv) => sum + Number(inv.amountPaid), 0);
    return { ...customer, vehicleCount: Number(vehicleCount.count), totalBilled, totalPaid };
  }));

  res.json({ data: enriched, total: Number(countResult[0].count), page, limit });
});

router.post("/", async (req, res) => {
  const { firstName, lastName, email, phone, address, city, state, zip, notes } = req.body;
  const [customer] = await db.insert(customersTable).values({ firstName, lastName, email, phone, address, city, state, zip, notes }).returning();
  res.status(201).json({ ...customer, vehicleCount: 0, totalBilled: 0, totalPaid: 0 });
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, id));
  if (!customer) return res.status(404).json({ error: "Customer not found" });
  const [vehicleCount] = await db.select({ count: sql<number>`count(*)` }).from(vehiclesTable).where(eq(vehiclesTable.customerId, id));
  const invoices = await db.select({ total: invoicesTable.total, amountPaid: invoicesTable.amountPaid }).from(invoicesTable).where(eq(invoicesTable.customerId, id));
  const totalBilled = invoices.reduce((sum, inv) => sum + Number(inv.total), 0);
  const totalPaid = invoices.reduce((sum, inv) => sum + Number(inv.amountPaid), 0);
  res.json({ ...customer, vehicleCount: Number(vehicleCount.count), totalBilled, totalPaid });
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { firstName, lastName, email, phone, address, city, state, zip, notes } = req.body;
  const [customer] = await db.update(customersTable).set({ firstName, lastName, email, phone, address, city, state, zip, notes, updatedAt: new Date() }).where(eq(customersTable.id, id)).returning();
  if (!customer) return res.status(404).json({ error: "Customer not found" });
  const [vehicleCount] = await db.select({ count: sql<number>`count(*)` }).from(vehiclesTable).where(eq(vehiclesTable.customerId, id));
  const invoices = await db.select({ total: invoicesTable.total, amountPaid: invoicesTable.amountPaid }).from(invoicesTable).where(eq(invoicesTable.customerId, id));
  const totalBilled = invoices.reduce((sum, inv) => sum + Number(inv.total), 0);
  const totalPaid = invoices.reduce((sum, inv) => sum + Number(inv.amountPaid), 0);
  res.json({ ...customer, vehicleCount: Number(vehicleCount.count), totalBilled, totalPaid });
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(customersTable).where(eq(customersTable.id, id));
  res.status(204).send();
});

router.get("/:id/vehicles", async (req, res) => {
  const id = Number(req.params.id);
  const vehicles = await db.select().from(vehiclesTable).where(eq(vehiclesTable.customerId, id)).orderBy(desc(vehiclesTable.createdAt));
  res.json(vehicles);
});

router.get("/:id/statement", async (req, res) => {
  const id = Number(req.params.id);
  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, id));
  if (!customer) return res.status(404).json({ error: "Customer not found" });
  const invoices = await db.select().from(invoicesTable).where(eq(invoicesTable.customerId, id)).orderBy(desc(invoicesTable.createdAt));
  const totalBilled = invoices.reduce((sum, inv) => sum + Number(inv.total), 0);
  const totalPaid = invoices.reduce((sum, inv) => sum + Number(inv.amountPaid), 0);
  const balance = totalBilled - totalPaid;
  const [vehicleCount] = await db.select({ count: sql<number>`count(*)` }).from(vehiclesTable).where(eq(vehiclesTable.customerId, id));
  res.json({
    customer: { ...customer, vehicleCount: Number(vehicleCount.count), totalBilled, totalPaid },
    invoices,
    totalBilled,
    totalPaid,
    balance,
  });
});

export default router;
