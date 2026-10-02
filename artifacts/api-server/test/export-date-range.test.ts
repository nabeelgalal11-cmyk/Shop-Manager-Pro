import assert from "node:assert/strict";
import test from "node:test";
import { parseExportDateRange } from "../src/lib/export-date-range.js";

test("accepts valid inclusive dates and omitted bounds", () => {
  assert.deepEqual(parseExportDateRange("2024-02-29", "2024-03-01"), {
    ok: true,
    range: { from: "2024-02-29", to: "2024-03-01" },
  });
  assert.deepEqual(parseExportDateRange(undefined, ""), {
    ok: true,
    range: { from: null, to: null },
  });
});

test("rejects invalid calendar dates instead of dropping the bound", () => {
  for (const value of ["2026-02-29", "2026-02-30", "2026-13-01", "0000-01-01"]) {
    const result = parseExportDateRange(value, undefined);
    assert.equal(result.ok, false, `expected ${value} to be rejected`);
    if (!result.ok) assert.match(result.error, /from must be a valid calendar date/);
  }
});

test("rejects malformed and repeated query values", () => {
  assert.deepEqual(parseExportDateRange("01/02/2026", undefined), {
    ok: false,
    error: "from must be a valid calendar date in YYYY-MM-DD format.",
  });
  assert.equal(parseExportDateRange(["2026-01-01"], undefined).ok, false);
});

test("rejects a reversed date range", () => {
  assert.deepEqual(parseExportDateRange("2026-02-02", "2026-02-01"), {
    ok: false,
    error: "from must be on or before to.",
  });
});