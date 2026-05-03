import { sql, type SQL } from "drizzle-orm";
import { db, shopSettingsTable } from "@workspace/db";

export interface RoProfitability {
  partsRevenue: number;
  partsCost: number;
  partsCostKnown: boolean;
  laborRevenue: number;
  laborCost: number;
  laborHoursWorked: number;
  laborHoursBilled: number;
  hasTimeEntries: boolean;
  techEfficiencyPct: number | null;
  effectiveLaborRate: number | null;
  grossProfit: number;
  grossMarginPct: number;
  totalRevenue: number;
  totalCost: number;
  laborRate: number;
  laborSource: "time_entries" | "ro_hours_fallback";
}

export async function getShopLaborRate(): Promise<number> {
  const [s] = await db.select().from(shopSettingsTable).limit(1);
  return s ? Number(s.laborRate) : 95;
}

export interface RoProfitRow {
  id: number;
  parts_revenue: string | number | null;
  parts_cost: string | number | null;
  parts_count: string | number | null;
  parts_cost_known_count: string | number | null;
  hours_worked_entries: string | number | null;
  hours_worked_unrated: string | number | null;
  labor_cost_entries: string | number | null;
  entry_count: string | number | null;
  actual_hours: string | number | null;
  estimated_hours: string | number | null;
}

// Shared SQL fragment that produces one row per repair order with the raw
// numbers needed to compute profitability. Used by the list, detail, and
// reports endpoints so they always agree.
export function roProfitabilitySql(extraWhere?: SQL): SQL {
  const where = extraWhere ? sql`WHERE ${extraWhere}` : sql``;
  return sql`
    SELECT
      ro.id,
      COALESCE(parts.parts_revenue, 0)::numeric AS parts_revenue,
      COALESCE(parts.parts_cost, 0)::numeric AS parts_cost,
      COALESCE(parts.parts_count, 0)::int AS parts_count,
      COALESCE(parts.parts_cost_known_count, 0)::int AS parts_cost_known_count,
      COALESCE(labor.hours_worked, 0)::numeric AS hours_worked_entries,
      COALESCE(labor.hours_worked_unrated, 0)::numeric AS hours_worked_unrated,
      COALESCE(labor.labor_cost, 0)::numeric AS labor_cost_entries,
      COALESCE(labor.entry_count, 0)::int AS entry_count,
      ro.actual_hours::numeric AS actual_hours,
      ro.estimated_hours::numeric AS estimated_hours
    FROM repair_orders ro
    LEFT JOIN LATERAL (
      SELECT
        SUM((p->>'quantity')::numeric * (p->>'unitPrice')::numeric) AS parts_revenue,
        SUM(
          (p->>'quantity')::numeric * COALESCE(
            inv.cost_price::numeric,
            NULLIF(p->>'unitCost','')::numeric,
            0
          )
        ) AS parts_cost,
        COUNT(*) AS parts_count,
        COUNT(*) FILTER (
          WHERE NULLIF(p->>'unitCost','') IS NOT NULL
             OR inv.cost_price IS NOT NULL
        ) AS parts_cost_known_count
      FROM jsonb_array_elements(COALESCE(ro.parts, '[]'::jsonb)) p
      LEFT JOIN inventory inv ON inv.id = NULLIF(p->>'inventoryId','')::int
    ) parts ON TRUE
    LEFT JOIN (
      SELECT
        t.repair_order_id,
        SUM(COALESCE(t.total_hours, 0)::numeric) AS hours_worked,
        SUM(
          CASE WHEN e.hourly_rate IS NULL
            THEN COALESCE(t.total_hours, 0)::numeric
            ELSE 0
          END
        ) AS hours_worked_unrated,
        SUM(COALESCE(t.total_hours, 0)::numeric * COALESCE(e.hourly_rate, 0)::numeric) AS labor_cost,
        COUNT(*) FILTER (WHERE t.total_hours IS NOT NULL) AS entry_count
      FROM time_entries t
      LEFT JOIN employees e ON e.id = t.employee_id
      WHERE t.repair_order_id IS NOT NULL
      GROUP BY t.repair_order_id
    ) labor ON labor.repair_order_id = ro.id
    ${where}
  `;
}

export function computeProfitability(row: RoProfitRow, laborRate: number): RoProfitability {
  const partsRevenue = Number(row.parts_revenue ?? 0);
  const partsCost = Number(row.parts_cost ?? 0);
  const partsCount = Number(row.parts_count ?? 0);
  const partsCostKnownCount = Number(row.parts_cost_known_count ?? 0);
  const partsCostKnown = partsCount === 0 || partsCostKnownCount === partsCount;

  const entryCount = Number(row.entry_count ?? 0);
  const hasTimeEntries = entryCount > 0;
  const hoursWorkedEntries = Number(row.hours_worked_entries ?? 0);
  const hoursWorkedUnrated = Number(row.hours_worked_unrated ?? 0);
  const laborCostEntries = Number(row.labor_cost_entries ?? 0);
  const actualHours = row.actual_hours == null ? null : Number(row.actual_hours);
  const estimatedHours = row.estimated_hours == null ? null : Number(row.estimated_hours);

  const hoursBilled = actualHours ?? estimatedHours ?? hoursWorkedEntries ?? 0;
  const hoursWorked = hasTimeEntries ? hoursWorkedEntries : (actualHours ?? estimatedHours ?? 0);

  const laborRevenue = hoursBilled * laborRate;
  // Per spec: cost from time entries (hours × employee rate), with a fallback
  // to RO estimated/actual hours × shop rate when there are no entries.
  // For entries with NULL employee rate the inner sum already used 0 — fall
  // back to shop rate for those hours so cost is never silently understated.
  let laborCost: number;
  let laborSource: "time_entries" | "ro_hours_fallback";
  if (hasTimeEntries) {
    laborSource = "time_entries";
    // Entries with NULL hourly_rate contribute 0 to laborCostEntries; top up
    // those specific hours at the shop labor rate so partial-rate sets aren't
    // silently understated.
    laborCost = laborCostEntries + hoursWorkedUnrated * laborRate;
  } else {
    laborSource = "ro_hours_fallback";
    laborCost = (actualHours ?? estimatedHours ?? 0) * laborRate;
  }

  const totalRevenue = partsRevenue + laborRevenue;
  const totalCost = partsCost + laborCost;
  const grossProfit = totalRevenue - totalCost;
  const grossMarginPct = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

  const techEfficiencyPct = hasTimeEntries && hoursWorked > 0
    ? (hoursBilled / hoursWorked) * 100
    : null;
  const effectiveLaborRate = hoursWorked > 0 ? laborRevenue / hoursWorked : null;

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const r1 = (n: number) => Math.round(n * 10) / 10;

  return {
    partsRevenue: r2(partsRevenue),
    partsCost: r2(partsCost),
    partsCostKnown,
    laborRevenue: r2(laborRevenue),
    laborCost: r2(laborCost),
    laborHoursWorked: r2(hoursWorked),
    laborHoursBilled: r2(hoursBilled),
    hasTimeEntries,
    techEfficiencyPct: techEfficiencyPct == null ? null : r1(techEfficiencyPct),
    effectiveLaborRate: effectiveLaborRate == null ? null : r2(effectiveLaborRate),
    grossProfit: r2(grossProfit),
    grossMarginPct: r1(grossMarginPct),
    totalRevenue: r2(totalRevenue),
    totalCost: r2(totalCost),
    laborRate,
    laborSource,
  };
}
