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
];

function isRenderDeployment() {
  return process.env.RENDER === "true" || Boolean(process.env.RENDER_SERVICE_ID);
}

/**
 * Render's free service does not provide a separate migration phase. Keep this
 * narrowly scoped to the two additive changes that must already exist in the
 * application schema, and only run it on Render deployments.
 */
export async function runRenderSchemaMigrations() {
  if (!isRenderDeployment() || process.env.NODE_ENV === "test") return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [RENDER_SCHEMA_LOCK]);

    for (const statement of [...ESTIMATE_TAX_COLUMN_SQL, ...SHOP_PROFILE_COLUMN_SQL]) {
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