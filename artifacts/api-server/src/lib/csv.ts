import type { Writable } from "stream";

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s: string;
  if (value instanceof Date) {
    s = value.toISOString().slice(0, 10);
  } else if (typeof value === "number") {
    s = Number.isFinite(value) ? String(value) : "";
  } else {
    s = String(value);
  }
  if (/[",\n\r]/.test(s)) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function csvRow(cells: unknown[]): string {
  return cells.map(escapeCell).join(",") + "\r\n";
}

export function buildCsv(headers: string[], rows: unknown[][]): string {
  let out = csvRow(headers);
  for (const r of rows) out += csvRow(r);
  return out;
}

export function writeCsv(
  stream: Writable,
  headers: string[],
  rows: Iterable<unknown[]>,
): void {
  stream.write(csvRow(headers));
  for (const r of rows) stream.write(csvRow(r));
}

export function moneyCell(n: unknown): string {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(2) : "0.00";
}

export function dateCell(d: unknown): string {
  if (!d) return "";
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  const s = String(d);
  return s.length >= 10 ? s.slice(0, 10) : s;
}
