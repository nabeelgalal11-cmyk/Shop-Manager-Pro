import { Router } from "express";
import { db } from "@workspace/db";
import {
  customersTable, vehiclesTable, repairOrdersTable, invoicesTable, inventoryTable,
  appointmentsTable, estimatesTable, expensesTable, paymentsTable,
} from "@workspace/db";
import { eq, sql, desc, gte, and, lte } from "drizzle-orm";

const router: Router = Router();

router.get("/summary", async (req, res) => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  const [
    totalCustomers,
    totalVehicles,
    openRepairOrders,
    completedThisMonth,
    unpaidInvoices,
    upcomingAppointments,
    lowStockItems,
    pendingEstimates,
    thisMonthPayments,
    lastMonthPayments,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(customersTable),
    db.select({ count: sql<number>`count(*)` }).from(vehiclesTable),
    db.select({ count: sql<number>`count(*)` }).from(repairOrdersTable).where(sql`status NOT IN ('completed','delivered','cancelled')`),
    db.select({ count: sql<number>`count(*)` }).from(repairOrdersTable).where(and(eq(repairOrdersTable.status, "completed"), gte(repairOrdersTable.completedAt, startOfMonth))),
    db.select({ count: sql<number>`count(*)`, total: sql<number>`sum(balance)` }).from(invoicesTable).where(sql`status NOT IN ('paid','void')`),
    db.select({ count: sql<number>`count(*)` }).from(appointmentsTable).where(and(gte(appointmentsTable.scheduledAt, now), lte(appointmentsTable.scheduledAt, endOfToday))),
    db.select({ count: sql<number>`count(*)` }).from(inventoryTable).where(sql`quantity <= min_quantity`),
    db.select({ count: sql<number>`count(*)` }).from(estimatesTable).where(sql`status IN ('draft','sent')`),
    db.select({ total: sql<number>`sum(amount)` }).from(paymentsTable).where(gte(paymentsTable.paidAt, startOfMonth)),
    db.select({ total: sql<number>`sum(amount)` }).from(paymentsTable).where(and(gte(paymentsTable.paidAt, startOfLastMonth), lte(paymentsTable.paidAt, endOfLastMonth))),
  ]);

  res.json({
    totalCustomers: Number(totalCustomers[0].count),
    totalVehicles: Number(totalVehicles[0].count),
    openRepairOrders: Number(openRepairOrders[0].count),
    completedThisMonth: Number(completedThisMonth[0].count),
    revenueThisMonth: Number(thisMonthPayments[0].total) || 0,
    revenueLastMonth: Number(lastMonthPayments[0].total) || 0,
    unpaidInvoices: Number(unpaidInvoices[0].count),
    unpaidAmount: Number(unpaidInvoices[0].total) || 0,
    upcomingAppointments: Number(upcomingAppointments[0].count),
    lowStockItems: Number(lowStockItems[0].count),
    pendingEstimates: Number(pendingEstimates[0].count),
  });
});

router.get("/recent-activity", async (req, res) => {
  const limit = Number(req.query.limit) || 10;

  const [recentOrders, recentInvoices, recentPayments] = await Promise.all([
    db.select().from(repairOrdersTable).orderBy(desc(repairOrdersTable.createdAt)).limit(4),
    db.select().from(invoicesTable).orderBy(desc(invoicesTable.createdAt)).limit(3),
    db.select().from(paymentsTable).orderBy(desc(paymentsTable.createdAt)).limit(3),
  ]);

  const activities = [
    ...recentOrders.map(o => ({ id: o.id, type: "repair_order", description: `Repair order ${o.orderNumber} created - ${o.status}`, entityId: o.id, entityType: "repair_order", createdAt: o.createdAt.toISOString() })),
    ...recentInvoices.map(i => ({ id: i.id + 1000, type: "invoice", description: `Invoice ${i.invoiceNumber} - ${i.status} - $${Number(i.total).toFixed(2)}`, entityId: i.id, entityType: "invoice", createdAt: i.createdAt.toISOString() })),
    ...recentPayments.map(p => ({ id: p.id + 2000, type: "payment", description: `Payment of $${Number(p.amount).toFixed(2)} received via ${p.method}`, entityId: p.id, entityType: "payment", createdAt: p.createdAt.toISOString() })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, limit);

  res.json(activities);
});

router.get("/revenue-chart", async (req, res) => {
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
    const [rev] = await db.select({ total: sql<number>`sum(amount)` }).from(paymentsTable).where(and(gte(paymentsTable.paidAt, d), lte(paymentsTable.paidAt, end)));
    const [exp] = await db.select({ total: sql<number>`sum(amount)` }).from(expensesTable).where(and(gte(expensesTable.expenseDate, d.toISOString().split("T")[0]), lte(expensesTable.expenseDate, end.toISOString().split("T")[0])));
    const revenue = Number(rev.total) || 0;
    const expenses = Number(exp.total) || 0;
    months.push({
      month: d.toLocaleString("default", { month: "short", year: "2-digit" }),
      revenue,
      expenses,
      profit: revenue - expenses,
    });
  }
  res.json(months);
});

router.get("/job-status-breakdown", async (req, res) => {
  const statuses = ["pending", "in_progress", "waiting_parts", "completed", "delivered", "cancelled"];
  const labels: Record<string, string> = {
    pending: "Pending", in_progress: "In Progress", waiting_parts: "Waiting Parts",
    completed: "Completed", delivered: "Delivered", cancelled: "Cancelled",
  };
  const results = await Promise.all(statuses.map(async (status) => {
    const [r] = await db.select({ count: sql<number>`count(*)` }).from(repairOrdersTable).where(eq(repairOrdersTable.status, status));
    return { status, count: Number(r.count), label: labels[status] };
  }));
  res.json(results);
});

router.get("/top-services", async (req, res) => {
  const limit = Number(req.query.limit) || 5;
  const orders = await db.select({ complaint: repairOrdersTable.complaint }).from(repairOrdersTable);
  const counts: Record<string, number> = {};
  for (const o of orders) {
    const service = o.complaint || "General Service";
    counts[service] = (counts[service] || 0) + 1;
  }
  const top = Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([service, count]) => ({ service, count, revenue: count * 150 }));
  res.json(top.length ? top : [
    { service: "Oil Change", count: 0, revenue: 0 },
    { service: "Brake Service", count: 0, revenue: 0 },
    { service: "Tire Rotation", count: 0, revenue: 0 },
  ]);
});

export default router;
