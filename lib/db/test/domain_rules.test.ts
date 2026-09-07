import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateInvoiceTotals,
  canTransitionEstimateRevision,
  canTransitionInvoice,
  canTransitionPayment,
  canTransitionRepairOrder,
  lineTotalCents,
  roundDiv,
} from "../src/domain_rules.ts";

test("repair-order transition matrix allows only operational forward/return paths", () => {
  assert.equal(canTransitionRepairOrder("open", "diagnosing"), true);
  assert.equal(canTransitionRepairOrder("awaiting_approval", "diagnosing"), true);
  assert.equal(canTransitionRepairOrder("authorized", "in_progress"), true);
  assert.equal(canTransitionRepairOrder("in_progress", "completed"), true);
  for (const terminal of ["completed", "cancelled"] as const) {
    for (const target of ["open", "diagnosing", "awaiting_approval", "authorized", "in_progress", "completed", "cancelled"] as const) {
      assert.equal(canTransitionRepairOrder(terminal, target), false);
    }
  }
});

test("revision transition matrix makes decisions final except superseding", () => {
  assert.equal(canTransitionEstimateRevision("draft", "sent"), true);
  for (const decision of ["approved", "partially_approved", "declined"] as const) {
    assert.equal(canTransitionEstimateRevision("sent", decision), true);
    assert.equal(canTransitionEstimateRevision(decision, "sent"), false);
    assert.equal(canTransitionEstimateRevision(decision, "superseded"), true);
  }
  assert.equal(canTransitionEstimateRevision("superseded", "draft"), false);
});

test("invoice and payment transition matrices include reversals but reject resurrection", () => {
  assert.equal(canTransitionInvoice("draft", "issued"), true);
  assert.equal(canTransitionInvoice("issued", "partially_paid"), true);
  assert.equal(canTransitionInvoice("partially_paid", "paid"), true);
  assert.equal(canTransitionInvoice("paid", "partially_paid"), true);
  assert.equal(canTransitionInvoice("void", "issued"), false);
  assert.equal(canTransitionPayment("pending", "failed"), true);
  assert.equal(canTransitionPayment("pending", "succeeded"), true);
  assert.equal(canTransitionPayment("succeeded", "refunded"), true);
  assert.equal(canTransitionPayment("failed", "pending"), false);
  assert.equal(canTransitionPayment("refunded", "succeeded"), false);
});

test("cent-safe quantities and half-away-from-zero rounding never use floats", () => {
  assert.equal(lineTotalCents({ quantityMilli: 1500n, unitPriceCents: 1999n }), 2999n);
  assert.equal(lineTotalCents({ quantityMilli: 125n, unitPriceCents: 4n }), 1n);
  assert.equal(lineTotalCents({ quantityMilli: 125n, unitPriceCents: 4n, kind: "discount" }), -1n);
  assert.equal(roundDiv(-5n, 2n), -3n);
  assert.throws(() => lineTotalCents({ quantityMilli: 0n, unitPriceCents: 1n }), RangeError);
  assert.throws(() => lineTotalCents({ quantityMilli: 1n, unitPriceCents: -1n }), RangeError);
});

test("discount and tax totals round exactly to cents", () => {
  const totals = calculateInvoiceTotals([
    { quantityMilli: 1500n, unitPriceCents: 1999n },
    { quantityMilli: 1000n, unitPriceCents: 500n, kind: "discount" },
  ], 662n);
  assert.deepEqual(totals, { subtotalCents: 2499n, taxCents: 165n, totalCents: 2664n });
  assert.deepEqual(calculateInvoiceTotals([{ quantityMilli: 1000n, unitPriceCents: 100n }], 10000n, true),
    { subtotalCents: 100n, taxCents: 0n, totalCents: 100n });
  assert.throws(() => calculateInvoiceTotals([], 10001n), RangeError);
});