import { db } from "@workspace/db";
import { inventoryTable, stockMovementsTable, type StockMovementReason } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";

// Either the top-level db or a transaction handle from db.transaction().
// Both share the same query surface used here, so accepting `any` keeps
// callers simple while still letting us thread a tx through for atomicity.
export type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

// Forward (apply) ↔ compensating (reverse) reason pairs. Used to make
// idempotency event-aware: an "apply" is allowed whenever the count of
// previously applied rows for the source key is balanced by an equal
// number of compensating reverses (so re-toggling back into the applied
// state correctly writes a new movement instead of being silently
// no-op'd by a stale leftover row).
const REASON_PAIR: Partial<Record<StockMovementReason, StockMovementReason>> = {
  purchase_received: "purchase_unreceived",
  invoice_consumed: "invoice_unconsumed",
  ro_consumed: "ro_unconsumed",
};

export interface MovementSource {
  inventoryId: number;
  delta: number;
  reason: StockMovementReason;
  referenceTable: string;
  referenceId: number;
  referenceLineId?: number | null;
  unitCost?: number | string | null;
  notes?: string;
  createdById?: number | null;
}

async function countByReason(
  executor: DbExecutor,
  inventoryId: number,
  referenceTable: string,
  referenceId: number,
  referenceLineId: number | null | undefined,
  reason: StockMovementReason,
): Promise<number> {
  const refLineKey = referenceLineId ?? 0;
  const [row] = await executor
    .select({ c: sql<number>`count(*)::int` })
    .from(stockMovementsTable)
    .where(and(
      eq(stockMovementsTable.inventoryId, inventoryId),
      eq(stockMovementsTable.reason, reason),
      eq(stockMovementsTable.referenceTable, referenceTable),
      eq(stockMovementsTable.referenceId, referenceId),
      sql`COALESCE(${stockMovementsTable.referenceLineId}, 0) = ${refLineKey}`,
    ));
  return Number(row?.c ?? 0);
}

/**
 * Apply a stock movement and bump inventory.quantity by `delta`.
 *
 * Event-aware idempotency: for paired reasons (e.g. purchase_received /
 * purchase_unreceived) we count `applies - reverses` for the source key.
 * If that count is already > 0, the entity is currently in the "applied"
 * state for this source and we skip writing a duplicate. After a
 * reversal, the count drops back to 0 and a re-toggle into the applied
 * state will correctly write a fresh movement.
 *
 * Pass an `executor` (transaction handle from `db.transaction(...)`) so
 * the count + insert + quantity bump participate in the caller's atomic
 * unit of work.
 */
export async function applyStockMovement(m: MovementSource, executor: DbExecutor = db) {
  const reverseReason = REASON_PAIR[m.reason];
  if (reverseReason) {
    const [applyCount, reverseCount] = await Promise.all([
      countByReason(executor, m.inventoryId, m.referenceTable, m.referenceId, m.referenceLineId, m.reason),
      countByReason(executor, m.inventoryId, m.referenceTable, m.referenceId, m.referenceLineId, reverseReason),
    ]);
    // Already net-applied — skip to keep the operation idempotent against
    // accidental double-apply (e.g. a retried request).
    if (applyCount - reverseCount > 0) return null;
  }

  const [inserted] = await executor.insert(stockMovementsTable).values({
    inventoryId: m.inventoryId,
    delta: m.delta,
    reason: m.reason,
    referenceTable: m.referenceTable,
    referenceId: m.referenceId,
    referenceLineId: m.referenceLineId ?? null,
    unitCost: m.unitCost != null ? String(m.unitCost) : null,
    notes: m.notes ?? null,
    createdById: m.createdById ?? null,
  }).returning();

  await executor.update(inventoryTable)
    .set({ quantity: sql`${inventoryTable.quantity} + ${m.delta}`, updatedAt: new Date() })
    .where(eq(inventoryTable.id, m.inventoryId));

  return inserted;
}

/**
 * Reverse the most recent unmatched apply for the source key by writing a
 * compensating movement with the negated delta. No-op if there is nothing
 * outstanding to reverse (applies <= reverses).
 */
export async function reverseStockMovement(opts: {
  inventoryId: number;
  originalReason: StockMovementReason;
  reverseReason: StockMovementReason;
  referenceTable: string;
  referenceId: number;
  referenceLineId?: number | null;
  notes?: string;
  createdById?: number | null;
}, executor: DbExecutor = db) {
  const refLineKey = opts.referenceLineId ?? 0;

  const [applyCount, reverseCount] = await Promise.all([
    countByReason(executor, opts.inventoryId, opts.referenceTable, opts.referenceId, opts.referenceLineId, opts.originalReason),
    countByReason(executor, opts.inventoryId, opts.referenceTable, opts.referenceId, opts.referenceLineId, opts.reverseReason),
  ]);
  // Nothing outstanding to undo.
  if (applyCount - reverseCount <= 0) return null;

  // Mirror the most recent apply (its delta + unit cost) so the
  // compensation is exact even if cycles used different quantities.
  const [latest] = await executor
    .select()
    .from(stockMovementsTable)
    .where(and(
      eq(stockMovementsTable.inventoryId, opts.inventoryId),
      eq(stockMovementsTable.reason, opts.originalReason),
      eq(stockMovementsTable.referenceTable, opts.referenceTable),
      eq(stockMovementsTable.referenceId, opts.referenceId),
      sql`COALESCE(${stockMovementsTable.referenceLineId}, 0) = ${refLineKey}`,
    ))
    .orderBy(desc(stockMovementsTable.id))
    .limit(1);

  if (!latest) return null;

  const [inserted] = await executor.insert(stockMovementsTable).values({
    inventoryId: opts.inventoryId,
    delta: -latest.delta,
    reason: opts.reverseReason,
    referenceTable: opts.referenceTable,
    referenceId: opts.referenceId,
    referenceLineId: opts.referenceLineId ?? null,
    unitCost: latest.unitCost,
    notes: opts.notes ?? null,
    createdById: opts.createdById ?? null,
  }).returning();

  await executor.update(inventoryTable)
    .set({ quantity: sql`${inventoryTable.quantity} + ${-latest.delta}`, updatedAt: new Date() })
    .where(eq(inventoryTable.id, opts.inventoryId));

  return inserted;
}

export async function getInventoryUnitCost(inventoryId: number, executor: DbExecutor = db): Promise<string | null> {
  const [row] = await executor
    .select({ costPrice: inventoryTable.costPrice })
    .from(inventoryTable)
    .where(eq(inventoryTable.id, inventoryId));
  return row?.costPrice ?? null;
}
