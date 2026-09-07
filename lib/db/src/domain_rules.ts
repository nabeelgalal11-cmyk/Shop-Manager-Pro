/**
 * Pure repair-domain rules. Monetary values are integer cents (never JS floats).
 * Persistence adapters should parse database numerics into cents at their boundary.
 */
export type RepairOrderStatus = "open" | "diagnosing" | "awaiting_approval" | "authorized" | "in_progress" | "completed" | "cancelled";
export type EstimateRevisionStatus = "draft" | "sent" | "approved" | "partially_approved" | "declined" | "superseded";
export type InvoiceStatus = "draft" | "issued" | "partially_paid" | "paid" | "void";
export type PaymentStatus = "pending" | "succeeded" | "failed" | "refunded" | "void";

const transitions = <T extends string>(map: Record<T, readonly T[]>) =>
  (from: T, to: T): boolean => map[from].includes(to);

export const canTransitionRepairOrder = transitions<RepairOrderStatus>({
  open: ["diagnosing", "awaiting_approval", "authorized", "cancelled"],
  diagnosing: ["awaiting_approval", "authorized", "cancelled"],
  awaiting_approval: ["authorized", "in_progress", "diagnosing", "cancelled"],
  authorized: ["in_progress", "awaiting_approval", "cancelled"],
  in_progress: ["completed", "authorized", "awaiting_approval", "cancelled"],
  completed: [],
  cancelled: [],
});
export const canTransitionEstimateRevision = transitions<EstimateRevisionStatus>({
  draft: ["sent", "superseded"],
  sent: ["approved", "partially_approved", "declined", "superseded"],
  approved: ["superseded"], partially_approved: ["superseded"], declined: ["superseded"], superseded: [],
});
export const canTransitionInvoice = transitions<InvoiceStatus>({
  draft: ["issued", "void"], issued: ["partially_paid", "paid", "void"],
  partially_paid: ["issued", "paid", "void"], paid: ["issued", "partially_paid"], void: [],
});
export const canTransitionPayment = transitions<PaymentStatus>({
  pending: ["succeeded", "failed", "void"], succeeded: ["refunded", "void"],
  failed: [], refunded: [], void: [],
});

export type CentsLine = { quantityMilli: bigint; unitPriceCents: bigint; kind?: "discount" | string };
export const roundDiv = (numerator: bigint, denominator: bigint): bigint => {
  if (denominator <= 0n) throw new RangeError("denominator must be positive");
  return numerator >= 0n ? (numerator + denominator / 2n) / denominator : (numerator - denominator / 2n) / denominator;
};
/** Quantity is thousandths, so 1.500 × 1999 cents is exactly rounded half-away-from-zero. */
export const lineTotalCents = ({ quantityMilli, unitPriceCents, kind }: CentsLine): bigint => {
  if (quantityMilli <= 0n || unitPriceCents < 0n) throw new RangeError("quantity must be positive and unit price cannot be negative");
  const total = roundDiv(quantityMilli * unitPriceCents, 1000n);
  return kind === "discount" ? -total : total;
};
export const calculateInvoiceTotals = (lines: readonly CentsLine[], taxRateBps: bigint, taxExempt = false) => {
  if (taxRateBps < 0n || taxRateBps > 10_000n) throw new RangeError("tax rate must be between 0 and 10000 bps");
  const subtotalCents = lines.reduce((sum, line) => sum + lineTotalCents(line), 0n);
  const taxCents = taxExempt ? 0n : roundDiv(subtotalCents * taxRateBps, 10_000n);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
};