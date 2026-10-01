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

const OPENING_STOCK_AND_OWNER_FUNDING_SQL = [
  `ALTER TABLE stock_movements
     ADD COLUMN IF NOT EXISTS effective_date date`,
  `UPDATE stock_movements
     SET effective_date = created_at::date
     WHERE effective_date IS NULL`,
  `ALTER TABLE stock_movements
     ALTER COLUMN effective_date SET DEFAULT CURRENT_DATE`,
  `ALTER TABLE stock_movements
     ALTER COLUMN effective_date SET NOT NULL`,
  `INSERT INTO stock_movements
     (inventory_id, delta, reason, reference_table, reference_id, unit_cost, notes, effective_date, created_at)
   SELECT i.id, i.quantity, 'opening_balance', 'inventory', i.id, i.cost_price,
          'Opening stock carried forward from inventory record', i.created_at::date, i.created_at
   FROM inventory i
   WHERE i.quantity > 0
     AND NOT EXISTS (
       SELECT 1 FROM stock_movements sm WHERE sm.inventory_id = i.id
     )`,
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

function isRenderDeployment() {
  return process.env.RENDER === "true" || Boolean(process.env.RENDER_SERVICE_ID);
}

/**
 * Render's free service does not provide a separate migration phase. Keep this
 * narrowly scoped to additive changes that must already exist in the
 * application schema, and only run it on Render deployments.
 */
export async function runRenderSchemaMigrations() {
  if (!isRenderDeployment() || process.env.NODE_ENV === "test") return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [RENDER_SCHEMA_LOCK]);

    for (const statement of [
      ...ESTIMATE_TAX_COLUMN_SQL,
      ...SHOP_PROFILE_COLUMN_SQL,
      ...INVENTORY_FITMENT_COLUMN_SQL,
      ...OPENING_STOCK_AND_OWNER_FUNDING_SQL,
    ]) {
      await client.query(statement);
    }

    await client.query("COMMIT");
    logger.info("Render schema migrations verified");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    logger.error({ err: error }, "Render schema migration failed");
    throw error;
  } finally {
    client.release();
  }
}