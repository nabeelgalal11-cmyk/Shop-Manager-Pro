import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: Router = Router();

async function q<T = any>(query: ReturnType<typeof sql>): Promise<T[]> {
  const result = await db.execute(query);
  return result.rows as T[];
}

// Revenue & business overview
router.get("/overview", async (_req, res) => {
  const inv = await q(sql`
    SELECT
      COALESCE(SUM(total), 0)::numeric       AS total_revenue,
      COALESCE(SUM(amount_paid), 0)::numeric AS total_paid,
      COUNT(*)::int                           AS invoice_count,
      COALESCE(AVG(total), 0)::numeric        AS avg_invoice
    FROM invoices
  `);
  const cars = await q(sql`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'sold' THEN selling_price ELSE 0 END), 0)::numeric    AS sold_revenue,
      COALESCE(SUM(CASE WHEN status = 'sold' THEN purchase_price ELSE 0 END), 0)::numeric   AS sold_cost,
      COALESCE(SUM(CASE WHEN status != 'sold' THEN selling_price ELSE 0 END), 0)::numeric   AS inventory_value,
      SUM(CASE WHEN status = 'sold'      THEN 1 ELSE 0 END)::int AS sold_count,
      SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END)::int AS available_count
    FROM used_cars
  `);
  const exp = await q(sql`
    SELECT COALESCE(SUM(amount), 0)::numeric AS total_expenses FROM expenses
  `);

  const i = inv[0] as any || {};
  const c = cars[0] as any || {};
  const e = exp[0] as any || {};

  const servicePaid = Number(i.total_paid ?? 0);
  const usedCarRevenue = Number(c.sold_revenue ?? 0);
  const usedCarCost = Number(c.sold_cost ?? 0);
  const expenses = Number(e.total_expenses ?? 0);

  res.json({
    serviceRevenue: Number(i.total_revenue ?? 0),
    servicePaid,
    invoiceCount: Number(i.invoice_count ?? 0),
    avgInvoice: Number(i.avg_invoice ?? 0),
    usedCarSoldRevenue: usedCarRevenue,
    usedCarSoldCost: usedCarCost,
    usedCarProfit: usedCarRevenue - usedCarCost,
    inventoryValue: Number(c.inventory_value ?? 0),
    usedCarSoldCount: Number(c.sold_count ?? 0),
    usedCarAvailableCount: Number(c.available_count ?? 0),
    totalExpenses: expenses,
    totalRevenue: Number(i.total_revenue ?? 0) + usedCarRevenue,
    totalProfit: servicePaid + (usedCarRevenue - usedCarCost) - expenses,
  });
});

// Revenue breakdown by customer category
router.get("/revenue-by-category", async (_req, res) => {
  const rows = await q(sql`
    SELECT
      COALESCE(cc.name, 'Uncategorized') AS category,
      COALESCE(SUM(i.total), 0)::numeric AS revenue,
      COUNT(i.id)::int                   AS invoice_count
    FROM invoices i
    LEFT JOIN customers c  ON i.customer_id = c.id
    LEFT JOIN customer_categories cc ON c.category_id = cc.id
    GROUP BY COALESCE(cc.name, 'Uncategorized')
    ORDER BY revenue DESC
  `);
  res.json(rows.map((r: any) => ({ ...r, revenue: Number(r.revenue) })));
});

// Monthly revenue trends — last 12 months
router.get("/monthly-revenue", async (_req, res) => {
  const rows = await q(sql`
    SELECT
      TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
      COALESCE(SUM(total), 0)::numeric                    AS revenue,
      COUNT(*)::int                                        AS count
    FROM invoices
    WHERE created_at >= NOW() - INTERVAL '12 months'
    GROUP BY DATE_TRUNC('month', created_at)
    ORDER BY month ASC
  `);
  res.json(rows.map((r: any) => ({ ...r, revenue: Number(r.revenue) })));
});

// Top customers by total spending
router.get("/top-customers", async (req, res) => {
  const limit = Number(req.query.limit) || 10;
  const rows = await q(sql`
    SELECT
      c.id,
      c.first_name || ' ' || c.last_name AS customer_name,
      c.email,
      COALESCE(cc.name, 'Uncategorized')         AS category,
      COUNT(i.id)::int                            AS invoice_count,
      COALESCE(SUM(i.total), 0)::numeric          AS total_spent,
      COALESCE(SUM(i.amount_paid), 0)::numeric    AS total_paid,
      COALESCE(SUM(i.balance), 0)::numeric        AS outstanding_balance
    FROM customers c
    LEFT JOIN invoices i ON i.customer_id = c.id
    LEFT JOIN customer_categories cc ON c.category_id = cc.id
    GROUP BY c.id, c.first_name, c.last_name, c.email, cc.name
    ORDER BY total_spent DESC
    LIMIT ${limit}
  `);
  res.json(rows.map((r: any) => ({
    ...r,
    total_spent: Number(r.total_spent),
    total_paid: Number(r.total_paid),
    outstanding_balance: Number(r.outstanding_balance),
  })));
});

// Expense breakdown by category
router.get("/expenses-by-category", async (_req, res) => {
  const rows = await q(sql`
    SELECT
      COALESCE(category, 'Uncategorized') AS category,
      COALESCE(SUM(amount), 0)::numeric   AS total,
      COUNT(*)::int                        AS count
    FROM expenses
    GROUP BY category
    ORDER BY total DESC
  `);
  res.json(rows.map((r: any) => ({ ...r, total: Number(r.total) })));
});

// Used car inventory & sales summary
router.get("/used-cars", async (_req, res) => {
  const byStatus = await q(sql`
    SELECT
      status,
      COUNT(*)::int                                             AS count,
      COALESCE(SUM(selling_price), 0)::numeric                 AS total_selling,
      COALESCE(SUM(purchase_price), 0)::numeric                AS total_cost,
      COALESCE(SUM(selling_price - purchase_price), 0)::numeric AS total_margin
    FROM used_cars
    GROUP BY status
    ORDER BY count DESC
  `);
  const monthly = await q(sql`
    SELECT
      TO_CHAR(DATE_TRUNC('month', sale_date::timestamp), 'YYYY-MM') AS month,
      COUNT(*)::int                                                    AS sold_count,
      COALESCE(SUM(selling_price), 0)::numeric                        AS revenue,
      COALESCE(SUM(selling_price - purchase_price), 0)::numeric       AS profit
    FROM used_cars
    WHERE status = 'sold' AND sale_date IS NOT NULL
    GROUP BY DATE_TRUNC('month', sale_date::timestamp)
    ORDER BY month DESC
    LIMIT 12
  `);
  res.json({
    byStatus: byStatus.map((r: any) => ({
      ...r,
      total_selling: Number(r.total_selling),
      total_cost: Number(r.total_cost),
      total_margin: Number(r.total_margin),
    })),
    monthlySales: monthly.map((r: any) => ({
      ...r,
      revenue: Number(r.revenue),
      profit: Number(r.profit),
    })),
  });
});

export default router;
