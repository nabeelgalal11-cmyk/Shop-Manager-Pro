import assert from "node:assert/strict";
import test from "node:test";
import { canRepayOwnerLoan, summarizeOwnerFunding } from "../src/lib/owner-funding.js";

test("owner funding summary separates loans, repayments, and contributions", () => {
  const summary = summarizeOwnerFunding([
    { type: "loan", amount: "125.40" },
    { type: "loan", amount: 24.6 },
    { type: "repayment", amount: "30.15" },
    { type: "contribution", amount: 18.75 },
  ]);

  assert.deepEqual(summary, {
    totalLoaned: 150,
    totalRepaid: 30.15,
    outstandingLoan: 119.85,
    totalContributed: 18.75,
  });
});

test("owner loan repayments cannot exceed the outstanding balance", () => {
  assert.equal(canRepayOwnerLoan(42.5, 42.5), true);
  assert.equal(canRepayOwnerLoan(42.5, 10.25), true);
  assert.equal(canRepayOwnerLoan(42.5, 42.51), false);
  assert.equal(canRepayOwnerLoan(0, 0.01), false);
});