import { pool } from "@workspace/db";
import { logger } from "./logger.js";

const RENDER_SCHEMA_LOCK = 91520260907;

const ESTIMATE_TAX_COLUMN_SQL = [
  `ALTER TABLE estimate_items
     ADD COLUMN IF NOT EXISTS price_includes_tax boolean NOT NULL DEFAULT false`,
  `ALTER TABLE repair_order_work_items
     ADD COLUMN IF NOT EXISTS price_includes_tax boolean NOT NULL DEFAULT false`,
  `ALTER TABLE invoice_items
     ADD COLUMN IF NOT EXISTS price_includes_tax boolean NOT NULL DEFAULT false`,
];

const SHOP_PROFILE_COLUMN_SQL = [
  `ALTER TABLE shop_settings ADD COLUMN IF NOT EXISTS shop_name text`,
  `ALTER TABLE shop_settings ADD COLUMN IF NOT EXISTS address_line1 text`,
  `ALTER TABLE shop_settings ADD COLUMN IF NOT EXISTS address_line2 text`,
  `ALTER TABLE shop_settings ADD COLUMN IF NOT EXISTS city text`,
  `ALTER TABLE shop_settings ADD COLUMN IF NOT EXISTS state text`,
  `ALTER TABLE shop_settings ADD COLUMN IF NOT EXISTS postal_code text`,
  `ALTER TABLE shop_settings ADD COLUMN IF NOT EXISTS phone text`,
  `ALTER TABLE shop_settings ADD COLUMN IF NOT EXISTS email text`,
  `ALTER TABLE shop_settings ADD COLUMN IF NOT EXISTS ein text`,
  `ALTER TABLE shop_settings ADD COLUMN IF NOT EXISTS website text`,
  `ALTER TABLE shop_settings ADD COLUMN IF NOT EXISTS additional_info text`,
  `ALTER TABLE shop_settings ADD COLUMN IF NOT EXISTS production_backup_success_date date`,
  `ALTER TABLE shop_settings ADD COLUMN IF NOT EXISTS production_backup_lock_token text`,
  `ALTER TABLE shop_settings ADD COLUMN IF NOT EXISTS production_backup_lock_date date`,
  `ALTER TABLE shop_settings ADD COLUMN IF NOT EXISTS production_backup_lock_until timestamptz`,
  `ALTER TABLE shop_settings ADD COLUMN IF NOT EXISTS production_backup_last_attempt_at timestamptz`,
  `ALTER TABLE shop_settings ADD COLUMN IF NOT EXISTS production_backup_last_error text`,
];

const INVENTORY_FITMENT_COLUMN_SQL = [
  `ALTER TABLE inventory ADD COLUMN IF NOT EXISTS compatible_vehicles text`,
];

const AUTH_STORAGE_SQL = [
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS auth_version integer NOT NULL DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS auth_sessions (
     sid text PRIMARY KEY,
     sess jsonb NOT NULL,
     expire timestamptz NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS auth_sessions_expire_idx ON auth_sessions (expire)`,
  `CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx ON auth_sessions ((sess->>'userId'))`,
  `CREATE TABLE IF NOT EXISTS auth_login_attempts (
     ip text PRIMARY KEY,
     attempt_count integer NOT NULL,
     expires_at timestamptz NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS auth_login_attempts_expires_at_idx
     ON auth_login_attempts (expires_at)`,
];

const OPENING_STOCK_PREPARE_SQL = [
  `ALTER TABLE stock_movements
     ADD COLUMN IF NOT EXISTS effective_date date`,
  `ALTER TABLE stock_movements
     ALTER COLUMN effective_date SET DEFAULT CURRENT_DATE`,
  `CREATE TABLE IF NOT EXISTS owner_funding_entries (
     id serial PRIMARY KEY,
     type text NOT NULL CHECK (type IN ('loan', 'contribution', 'repayment')),
     amount numeric(10, 2) NOT NULL CHECK (amount > 0),
     entry_date date NOT NULL,
     description text NOT NULL,
     notes text,
     created_at timestamptz NOT NULL DEFAULT now(),
     created_by_id integer
   )`,
  `CREATE INDEX IF NOT EXISTS owner_funding_entries_entry_date_idx
     ON owner_funding_entries (entry_date, id)`,
];

const OPENING_STOCK_NOT_NULL_CONSTRAINT = "stock_movements_effective_date_not_null_check";
const OPENING_STOCK_BACKFILL_BATCH_SIZE = 100_000;
const OPENING_STOCK_BACKFILL_YIELD_MS = 25;

function isRenderDeployment() {
  return process.env.RENDER === "true" || Boolean(process.env.RENDER_SERVICE_ID);
}

type RenderMigrationClient = {
  query: (text: string, values?: any[]) => Promise<any>;
};

async function withTransaction(
  client: RenderMigrationClient,
  run: () => Promise<void>,
) {
  await client.query("BEGIN");
  try {
    await run();
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function runTimedMigrationPhase(phase: string, run: () => Promise<void>) {
  const startedAt = performance.now();
  logger.info({ phase, elapsedMs: 0 }, "Render schema migration phase started");
  try {
    await run();
  } catch (error) {
    logger.error(
      { err: error, phase, elapsedMs: Math.round(performance.now() - startedAt) },
      "Render schema migration phase failed",
    );
    throw error;
  }
  logger.info(
    { phase, elapsedMs: Math.round(performance.now() - startedAt) },
    "Render schema migration phase completed",
  );
}

async function backfillEffectiveDates(client: RenderMigrationClient) {
  // Keep this data rewrite outside the DDL transaction and commit in bounded
  // batches. UPDATE takes ROW EXCLUSIVE (compatible with normal reads and
  // writes), unlike the ACCESS EXCLUSIVE lock from ALTER TABLE.
  let lastUpdatedId = 0;
  let totalRowsUpdated = 0;
  let batch = 0;
  for (;;) {
    batch += 1;
    const batchStartedAt = performance.now();
    logger.info(
      {
        batch,
        batchSize: OPENING_STOCK_BACKFILL_BATCH_SIZE,
        elapsedMs: 0,
      },
      "Render stock movement date backfill batch started",
    );

    let nextLastUpdatedId: number | null = null;
    let rowsUpdated = 0;
    await withTransaction(client, async () => {
      const result = await client.query(
        `WITH batch AS (
           SELECT id
           FROM stock_movements
           WHERE id > $1 AND effective_date IS NULL
           ORDER BY id
           LIMIT $2
           FOR UPDATE
         ),
         updated AS (
           UPDATE stock_movements AS sm
           SET effective_date = sm.created_at::date
           FROM batch
           WHERE sm.id = batch.id
           RETURNING sm.id
         )
         SELECT max(id) AS last_id, count(*)::text AS row_count
         FROM updated`,
        [lastUpdatedId, OPENING_STOCK_BACKFILL_BATCH_SIZE],
      );
      rowsUpdated = Number(result.rows[0]?.row_count ?? 0);
      if (rowsUpdated > 0) {
        nextLastUpdatedId = result.rows[0].last_id;
      }
    });
    totalRowsUpdated += rowsUpdated;
    logger.info(
      {
        batch,
        rowsUpdated,
        totalRowsUpdated,
        elapsedMs: Math.round(performance.now() - batchStartedAt),
      },
      "Render stock movement date backfill batch completed",
    );
    if (nextLastUpdatedId === null) break;
    lastUpdatedId = nextLastUpdatedId;
    // Leave brief windows for other database sessions between write batches.
    await client.query(`SELECT pg_sleep(${OPENING_STOCK_BACKFILL_YIELD_MS / 1000})`);
  }
}

async function ensureEffectiveDateNotNull(client: RenderMigrationClient) {
  await withTransaction(client, async () => {
    const existingConstraint = await client.query(
      `SELECT 1
       FROM pg_constraint
       WHERE conrelid = 'stock_movements'::regclass
         AND conname = $1`,
      [OPENING_STOCK_NOT_NULL_CONSTRAINT],
    );
    if (existingConstraint.rowCount === 0) {
      await client.query(
        `ALTER TABLE stock_movements
         ADD CONSTRAINT ${OPENING_STOCK_NOT_NULL_CONSTRAINT}
         CHECK (effective_date IS NOT NULL) NOT VALID`,
      );
    }
  });

  // PostgreSQL validates a CHECK constraint with a lock that permits normal
  // reads and writes. Keeping this scan outside the DDL transaction avoids
  // holding an ACCESS EXCLUSIVE lock while a large movement table is scanned.
  await client.query(
    `ALTER TABLE stock_movements
     VALIDATE CONSTRAINT ${OPENING_STOCK_NOT_NULL_CONSTRAINT}`,
  );

  await withTransaction(client, async () => {
    await client.query(
      `ALTER TABLE stock_movements
       ALTER COLUMN effective_date SET NOT NULL`,
    );
    await client.query(
      `ALTER TABLE stock_movements
       DROP CONSTRAINT ${OPENING_STOCK_NOT_NULL_CONSTRAINT}`,
    );
  });
}

async function insertOpeningStockMovements(client: RenderMigrationClient) {
  await withTransaction(client, async () => {
    // Prevent a concurrent legacy writer from adding the first movement for
    // an item between the existence check and opening-row insert. SHARE still
    // permits reads; only stock-movement writers pause for this short step.
    await client.query("LOCK TABLE stock_movements IN SHARE MODE");
    await client.query(
      `INSERT INTO stock_movements
         (inventory_id, delta, reason, reference_table, reference_id, unit_cost, notes, effective_date, created_at)
       SELECT i.id, i.quantity, 'opening_balance', 'inventory', i.id, i.cost_price,
              'Opening stock carried forward from inventory record', i.created_at::date, i.created_at
       FROM inventory i
       WHERE i.quantity > 0
         AND NOT EXISTS (
           SELECT 1 FROM stock_movements sm WHERE sm.inventory_id = i.id
         )`,
    );
  });
}

/**
 * Render's free service does not provide a separate migration phase. Keep this
 * narrowly scoped to additive changes that must already exist in the
 * application schema, and only run it on Render deployments.
 */
export async function runRenderSchemaMigrations() {
  if (!isRenderDeployment() || process.env.NODE_ENV === "test") return;

  const client = await pool.connect();
  let advisoryLockAcquired = false;
  try {
    // Keep migration runs from multiple starting instances serialized even
    // though the large data backfill now commits in bounded batches.
    await client.query("SELECT pg_advisory_lock($1)", [RENDER_SCHEMA_LOCK]);
    advisoryLockAcquired = true;

    await runTimedMigrationPhase("schema preparation", async () => {
      await withTransaction(client, async () => {
        for (const statement of [
          ...ESTIMATE_TAX_COLUMN_SQL,
          ...SHOP_PROFILE_COLUMN_SQL,
          ...INVENTORY_FITMENT_COLUMN_SQL,
          ...AUTH_STORAGE_SQL,
          ...OPENING_STOCK_PREPARE_SQL,
        ]) {
          await client.query(statement);
        }
      });
    });

    await runTimedMigrationPhase("effective-date backfill", () =>
      backfillEffectiveDates(client),
    );
    await runTimedMigrationPhase("effective-date constraint", () =>
      ensureEffectiveDateNotNull(client),
    );
    await runTimedMigrationPhase("opening-stock movements", () =>
      insertOpeningStockMovements(client),
    );
    logger.info("Render schema migrations verified");
  } catch (error) {
    logger.error({ err: error }, "Render schema migration failed");
    throw error;
  } finally {
    if (advisoryLockAcquired) {
      await client.query("SELECT pg_advisory_unlock($1)", [RENDER_SCHEMA_LOCK]).catch(() => undefined);
    }
    client.release();
  }
}