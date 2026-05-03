import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requirePermission } from "../lib/auth.js";
import {
  computeProfitability,
  getShopLaborRate,
  roProfitabilitySql,
  type RoProfitRow,
} from "../lib/profitability.js";

const router: Router = Router();

router.use(requirePermission("reports", "view"));

async function q<T = any>(query: ReturnType<typeof sql>): Promise<T[]> {
  const result = await db.execute(query);
  return result.rows as T[];
}

// Revenue & business overview. Optional `from` / `to` (YYYY-MM-DD) filter
// the revenue / COGS window; if omitted, all-time totals are returned.
router.get("/overview", async (req, res) => {
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const fromTs = from ? new Date(from + "T00:00:00Z") : null;
  const toTs = to ? new Date(to + "T23:59:59Z") : null;
  const invWhere = sql`
    ${fromTs ? sql`AND created_at >= ${fromTs}` : sql``}
    ${toTs ? sql`AND created_at <= ${toTs}` : sql``}
  `;

  const inv = await q(sql`
    SELECT
      COALESCE(SUM(total), 0)::numeric       AS total_revenue,
      COALESCE(SUM(amount_paid), 0)::numeric AS total_paid,
      COUNT(*)::int                           AS invoice_count,
      COALESCE(AVG(total), 0)::numeric        AS avg_invoice
    FROM invoices
    WHERE 1=1 ${invWhere}
  `);

  // COGS = absolute value of negative consumption movements * unit cost.
  // Reasons that count: ro_consumed, invoice_consumed (compensating
  // un-consumed movements have positive deltas and net out automatically).
  const cogsRows = await q(sql`
    SELECT
      COALESCE(SUM((-delta) * COALESCE(unit_cost, 0)), 0)::numeric AS cogs
    FROM stock_movements
    WHERE reason IN ('ro_consumed','invoice_consumed','ro_unconsumed','invoice_unconsumed')
      ${fromTs ? sql`AND created_at >= ${fromTs}` : sql``}
      ${toTs ? sql`AND created_at <= ${toTs}` : sql``}
  `);
  const partsCogs = Number((cogsRows[0] as any)?.cogs ?? 0);
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

  // Online (Stripe) payments collected within the same window. Lets the shop
  // reconcile Stripe payouts against ShopOS without leaving the page.
  const onlineRows = await q(sql`
    SELECT COALESCE(SUM(amount), 0)::numeric AS total
    FROM payments
    WHERE method = 'stripe'
      AND status = 'succeeded'
      ${fromTs ? sql`AND paid_at >= ${fromTs}` : sql``}
      ${toTs ? sql`AND paid_at <= ${toTs}` : sql``}
  `);

  const i = inv[0] as any || {};
  const c = cars[0] as any || {};
  const e = exp[0] as any || {};
  const onlinePayments = Number((onlineRows[0] as any)?.total ?? 0);

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
    // Net profit subtracts parts COGS so the API and UI report the same
    // bottom-line number; clients should rely on this server value.
    totalProfit: servicePaid + (usedCarRevenue - usedCarCost) - expenses - partsCogs,
    cogs: partsCogs,
    onlinePayments,
    range: { from: from ?? null, to: to ?? null },
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

// Per-car used-car profitability (purchase + recon parts + labor)
router.get("/used-car-profitability", requirePermission("used_cars", "view"), async (req, res) => {
  type SettingsRow = { labor_rate: number | string | null };
  const settings = await q<SettingsRow>(sql`SELECT labor_rate FROM shop_settings LIMIT 1`);
  const laborRate = Number(settings[0]?.labor_rate ?? 95);

  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  const rows = await q(sql`
    SELECT
      c.id,
      c.year, c.make, c.model, c.trim,
      c.status,
      c.purchase_price::numeric  AS purchase_price,
      c.selling_price::numeric   AS selling_price,
      c.sale_date,
      COALESCE(pli.parts_total, 0)::numeric AS purchase_parts,
      COALESCE(ro_parts.total, 0)::numeric AS ro_parts,
      COALESCE(labor.total, 0)::numeric AS labor_cost,
      COALESCE(labor.hours, 0)::numeric AS hours
    FROM used_cars c
    LEFT JOIN (
      SELECT used_car_id, SUM(quantity::numeric * unit_cost::numeric) AS parts_total
      FROM purchase_line_items WHERE used_car_id IS NOT NULL
      GROUP BY used_car_id
    ) pli ON pli.used_car_id = c.id
    LEFT JOIN (
      SELECT ro.used_car_id, SUM(COALESCE((
        SELECT SUM((p->>'quantity')::numeric * (p->>'unitPrice')::numeric)
        FROM jsonb_array_elements(COALESCE(ro.parts, '[]'::jsonb)) p
      ), 0)) AS total
      FROM repair_orders ro
      WHERE ro.internal = true AND ro.used_car_id IS NOT NULL
      GROUP BY ro.used_car_id
    ) ro_parts ON ro_parts.used_car_id = c.id
    LEFT JOIN (
      SELECT ro.used_car_id,
        SUM(
          CASE WHEN te.has_entries THEN te.cost
               ELSE COALESCE(ro.actual_hours, ro.estimated_hours, 0)::numeric * ${laborRate}
          END
        ) AS total,
        SUM(
          CASE WHEN te.has_entries THEN te.hours
               ELSE COALESCE(ro.actual_hours, ro.estimated_hours, 0)::numeric
          END
        ) AS hours
      FROM repair_orders ro
      LEFT JOIN (
        SELECT repair_order_id, true AS has_entries,
          SUM(COALESCE(total_hours, 0)::numeric) AS hours,
          SUM(COALESCE(total_hours, 0)::numeric * COALESCE(e.hourly_rate, ${laborRate})::numeric) AS cost
        FROM time_entries t
        LEFT JOIN employees e ON e.id = t.employee_id
        WHERE repair_order_id IS NOT NULL
        GROUP BY repair_order_id
      ) te ON te.repair_order_id = ro.id
      WHERE ro.internal = true AND ro.used_car_id IS NOT NULL
      GROUP BY ro.used_car_id
    ) labor ON labor.used_car_id = c.id
    ORDER BY c.created_at DESC
  `);

  type ProfitRow = {
    id: number; year: number | null; make: string | null; model: string | null; trim: string | null;
    status: string; purchase_price: number | string; selling_price: number | string; sale_date: string | Date | null;
    purchase_parts: number | string | null; ro_parts: number | string | null; labor_cost: number | string | null; hours: number | string | null;
  };

  const allRows = (rows as ProfitRow[]).map(r => {
    const purchasePrice = Number(r.purchase_price);
    const sellingPrice = Number(r.selling_price);
    const reconParts = Number(r.purchase_parts ?? 0) + Number(r.ro_parts ?? 0);
    const reconLabor = Number(r.labor_cost ?? 0);
    const reconTotal = reconParts + reconLabor;
    const totalCost = purchasePrice + reconTotal;
    const grossMargin = sellingPrice - purchasePrice;
    const netProfit = sellingPrice - totalCost;
    const marginPct = sellingPrice > 0 ? Math.round((netProfit / sellingPrice) * 1000) / 10 : 0;
    return {
      id: r.id,
      vehicle: [r.year, r.make, r.model, r.trim].filter(Boolean).join(" "),
      status: r.status,
      saleDate: r.sale_date ? String(r.sale_date).slice(0, 10) : null,
      purchasePrice, sellingPrice, reconParts, reconLabor, reconTotal,
      totalCost, grossMargin, netProfit, marginPct,
      hours: Number(r.hours ?? 0),
    };
  });

  // Per-task spec: report scope = SOLD cars within [from, to]. Both `data` and
  // `summary` reflect the same filtered set so the table and totals agree.
  const data = allRows.filter(c => {
    if (c.status !== "sold") return false;
    if (from && (!c.saleDate || c.saleDate < from)) return false;
    if (to && (!c.saleDate || c.saleDate > to)) return false;
    return true;
  });

  res.json({
    data,
    laborRate,
    range: { from: from ?? null, to: to ?? null },
    summary: {
      soldCount: data.length,
      totalRevenue: data.reduce((s, c) => s + c.sellingPrice, 0),
      totalCost: data.reduce((s, c) => s + c.totalCost, 0),
      totalRecon: data.reduce((s, c) => s + c.reconTotal, 0),
      netProfit: data.reduce((s, c) => s + c.netProfit, 0),
    },
  });
});

// Per-RO profitability — top 10 most & least profitable plus average margin.
// Scope = repair orders created within [from, to] (defaults: all-time).
router.get("/repair-order-profitability", async (req, res) => {
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const fromTs = from ? new Date(from + "T00:00:00Z") : null;
  const toTs = to ? new Date(to + "T23:59:59Z") : null;

  const laborRate = await getShopLaborRate();

  const where = sql`
    ro.internal IS NOT TRUE
    ${fromTs ? sql`AND ro.created_at >= ${fromTs}` : sql``}
    ${toTs ? sql`AND ro.created_at <= ${toTs}` : sql``}
  `;

  const profitRows = await db.execute(sql`${roProfitabilitySql(where)}`);
  const meta = await db.execute(sql`
    SELECT
      ro.id,
      ro.order_number,
      ro.status,
      ro.created_at,
      ro.completed_at,
      c.first_name AS customer_first,
      c.last_name AS customer_last,
      v.year, v.make, v.model
    FROM repair_orders ro
    LEFT JOIN customers c ON c.id = ro.customer_id
    LEFT JOIN vehicles v ON v.id = ro.vehicle_id
    WHERE ${where}
  `);

  type MetaRow = {
    id: number;
    order_number: string;
    status: string;
    created_at: string | Date;
    completed_at: string | Date | null;
    customer_first: string | null;
    customer_last: string | null;
    year: number | null;
    make: string | null;
    model: string | null;
  };

  const metaMap = new Map<number, MetaRow>();
  for (const m of meta.rows as MetaRow[]) metaMap.set(Number(m.id), m);

  const all = (profitRows.rows as unknown as RoProfitRow[]).map(r => {
    const id = Number(r.id);
    const p = computeProfitability(r, laborRate);
    const m = metaMap.get(id);
    const customer = m && (m.customer_first || m.customer_last)
      ? `${m.customer_first ?? ""} ${m.customer_last ?? ""}`.trim()
      : null;
    const vehicle = m
      ? [m.year, m.make, m.model].filter(Boolean).join(" ") || null
      : null;
    return {
      id,
      orderNumber: m?.order_number ?? null,
      status: m?.status ?? null,
      createdAt: m?.created_at ? new Date(m.created_at).toISOString() : null,
      completedAt: m?.completed_at ? new Date(m.completed_at).toISOString() : null,
      customer,
      vehicle,
      partsRevenue: p.partsRevenue,
      partsCost: p.partsCost,
      laborRevenue: p.laborRevenue,
      laborCost: p.laborCost,
      totalRevenue: p.totalRevenue,
      totalCost: p.totalCost,
      grossProfit: p.grossProfit,
      grossMarginPct: p.grossMarginPct,
      laborHoursWorked: p.laborHoursWorked,
      laborHoursBilled: p.laborHoursBilled,
    };
  }).filter(r => r.totalRevenue > 0); // exclude empty/draft ROs with no revenue

  const sorted = [...all].sort((a, b) => b.grossMarginPct - a.grossMarginPct);
  const top = sorted.slice(0, 10);
  const bottom = [...sorted].reverse().slice(0, 10);

  const avgMarginPct = all.length > 0
    ? Math.round((all.reduce((s, r) => s + r.grossMarginPct, 0) / all.length) * 10) / 10
    : 0;
  const totalRevenue = all.reduce((s, r) => s + r.totalRevenue, 0);
  const totalCost = all.reduce((s, r) => s + r.totalCost, 0);
  const totalProfit = totalRevenue - totalCost;

  res.json({
    range: { from: from ?? null, to: to ?? null },
    laborRate,
    summary: {
      orderCount: all.length,
      avgMarginPct,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalCost: Math.round(totalCost * 100) / 100,
      totalProfit: Math.round(totalProfit * 100) / 100,
    },
    top,
    bottom,
  });
});

// GET /api/reports/reorder — items at or below their min-quantity grouped by
// preferred supplier. The "Unassigned" group collects items with no preferred
// supplier so they can still be acted on (assign + reorder).
router.get("/reorder", async (_req, res) => {
  const rows = await db.execute(sql`
    SELECT
      i.id,
      i.part_number AS "partNumber",
      i.name,
      i.category,
      i.quantity,
      i.min_quantity AS "minQuantity",
      i.cost_price AS "costPrice",
      i.preferred_supplier_id AS "preferredSupplierId",
      s.name AS "supplierName",
      s.account_number AS "supplierAccountNumber",
      s.contact_email AS "supplierEmail"
    FROM inventory i
    LEFT JOIN suppliers s ON s.id = i.preferred_supplier_id
    WHERE i.quantity <= i.min_quantity AND i.min_quantity > 0
    ORDER BY s.name NULLS LAST, i.name
  `);

  const groups = new Map<string, {
    supplierId: number | null;
    supplierName: string | null;
    accountNumber: string | null;
    contactEmail: string | null;
    items: any[];
    estimatedCost: number;
  }>();

  for (const r of rows.rows as any[]) {
    const key = r.preferredSupplierId === null ? "unassigned" : `s${r.preferredSupplierId}`;
    if (!groups.has(key)) {
      groups.set(key, {
        supplierId: r.preferredSupplierId ?? null,
        supplierName: r.supplierName ?? null,
        accountNumber: r.supplierAccountNumber ?? null,
        contactEmail: r.supplierEmail ?? null,
        items: [],
        estimatedCost: 0,
      });
    }
    const g = groups.get(key)!;
    const reorderQty = Math.max(1, Number(r.minQuantity) - Number(r.quantity));
    const lineCost = reorderQty * Number(r.costPrice ?? 0);
    g.items.push({
      id: r.id,
      partNumber: r.partNumber,
      name: r.name,
      category: r.category,
      quantity: Number(r.quantity),
      minQuantity: Number(r.minQuantity),
      costPrice: Number(r.costPrice ?? 0),
      reorderQty,
      lineCost,
    });
    g.estimatedCost += lineCost;
  }

  res.json({
    groups: Array.from(groups.values()).map((g) => ({
      ...g,
      estimatedCost: Math.round(g.estimatedCost * 100) / 100,
      itemCount: g.items.length,
    })),
    totalItems: Array.from(groups.values()).reduce((s, g) => s + g.items.length, 0),
  });
});

export default router;
