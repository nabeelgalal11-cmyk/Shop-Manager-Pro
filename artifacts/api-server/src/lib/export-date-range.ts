export interface DateRange {
  from: string | null;
  to: string | null;
}

export type ExportDateRangeResult =
  | { ok: true; range: DateRange }
  | { ok: false; error: string };

function isIsoCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  if (value.startsWith("0000")) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function parseBound(value: unknown, name: "from" | "to"): { value: string | null } | { error: string } {
  if (value === undefined || value === null || value === "") return { value: null };
  if (!isIsoCalendarDate(value)) {
    return { error: `${name} must be a valid calendar date in YYYY-MM-DD format.` };
  }
  return { value };
}

export function parseExportDateRange(fromValue: unknown, toValue: unknown): ExportDateRangeResult {
  const from = parseBound(fromValue, "from");
  if ("error" in from) return { ok: false, error: from.error };

  const to = parseBound(toValue, "to");
  if ("error" in to) return { ok: false, error: to.error };

  if (from.value && to.value && from.value > to.value) {
    return { ok: false, error: "from must be on or before to." };
  }

  return {
    ok: true,
    range: { from: from.value, to: to.value },
  };
}