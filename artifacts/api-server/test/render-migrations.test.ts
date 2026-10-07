import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { startAfterSchemaMigrations } from "../src/lib/startup.js";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(apiRoot, "../..");
const openingStockMigration = path.join(
  workspaceRoot,
  "lib/db/migrations/2026-10-01_opening_stock_owner_funding.sql",
);
const migrations = [
  path.join(
    workspaceRoot,
    "lib/db/migrations/2026-09-07_estimate_part_price_includes_tax.sql",
  ),
  path.join(
    workspaceRoot,
    "lib/db/migrations/2026-09-07_shop_business_information.sql",
  ),
  path.join(
    workspaceRoot,
    "lib/db/migrations/2026-09-18_inventory_fitment.sql",
  ),
  openingStockMigration,
  path.join(workspaceRoot, "lib/db/migrations/2026-10-05_persistent_auth_storage.sql"),
];

let dataDirectory: string;
let serverLog: string;
let socketDirectory: string;
let databaseUrl: string;
let migrationBundlePath: string;
let pgPort: number;
let postgresStarted = false;

function run(command: string, args: string[], env = process.env) {
  return execFileSync(command, args, {
    cwd: apiRoot,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function psql(sql: string, database = databaseUrl) {
  return run("psql", [database, "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", sql]);
}

function runAsync(command: string, args: string[], env = process.env) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: apiRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${command} exited ${code}: ${stderr}`));
    });
  });
}

function databaseUrlForApplication(database: string, applicationName: string) {
  const url = new URL(database);
  url.searchParams.set("application_name", applicationName);
  return url.toString();
}

function startRenderStartup(database: string, applicationName: string) {
  const startupCode = `
    import { runRenderSchemaMigrations } from ${JSON.stringify(migrationBundlePath)};
    import { startAfterSchemaMigrations } from "./src/lib/startup.ts";
    let exitCode = 0;
    await startAfterSchemaMigrations({
      runMigrations: runRenderSchemaMigrations,
      start: () => console.log("STARTUP_READY"),
      logger: { error: (details, message) => console.error(message, details.err) },
      exit: (code) => { exitCode = code; },
    });
    if (exitCode !== 0) process.exit(exitCode);
  `;
  const result = runAsync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", startupCode],
    {
      ...process.env,
      DATABASE_URL: databaseUrlForApplication(database, applicationName),
      NODE_ENV: "production",
      RENDER: "true",
    },
  ).then(
    (output) => ({ ok: true as const, output }),
    (error) => ({ ok: false as const, error }),
  );
  return result;
}

async function waitForDatabaseCondition(
  sql: string,
  database: string,
  description: string,
) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (psql(sql, database) === "1") return;
    await delay(25);
  }
  assert.equal(psql(sql, database), "1", description);
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseJsonLogLines(output: string) {
  return output.split("\n").flatMap((line) => {
    try {
      const parsed = JSON.parse(line);
      return parsed && typeof parsed === "object" ? [parsed] : [];
    } catch {
      return [];
    }
  });
}

function allocatePort() {
  return new Promise<number>((resolve, reject) => {
    const listener = net.createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      if (!address || typeof address === "string") {
        listener.close();
        reject(new Error("Could not allocate a local PostgreSQL port"));
        return;
      }
      listener.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

before(async () => {
  const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "render-schema-test-"));
  dataDirectory = path.join(tempDirectory, "data");
  serverLog = path.join(tempDirectory, "postgres.log");
  socketDirectory = path.join(tempDirectory, "socket");
  migrationBundlePath = path.join(tempDirectory, "render-migrations.mjs");
  mkdirSync(socketDirectory);
  pgPort = await allocatePort();
  databaseUrl = `postgresql://postgres@127.0.0.1:${pgPort}/postgres`;

  await build({
    entryPoints: [path.join(apiRoot, "src/lib/render-migrations.ts")],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    outfile: migrationBundlePath,
    banner: {
      js: "import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);",
    },
  });

  execFileSync("initdb", [
    "-D",
    dataDirectory,
    "--auth=trust",
    "--username=postgres",
    "--no-instructions",
  ]);
  execFileSync("pg_ctl", [
    "-D",
    dataDirectory,
    "-l",
    serverLog,
    "-o",
    `-h 127.0.0.1 -p ${pgPort} -k ${socketDirectory}`,
    "-w",
    "-t",
    "20",
    "start",
  ]);
  postgresStarted = true;

  psql(`
    CREATE TABLE employees (id serial PRIMARY KEY);
    CREATE TABLE estimate_items (id integer PRIMARY KEY, description text, amount numeric);
    CREATE TABLE repair_order_work_items (id integer PRIMARY KEY, description text, amount numeric);
    CREATE TABLE invoice_items (id integer PRIMARY KEY, description text, amount numeric);
    CREATE TABLE shop_settings (id integer PRIMARY KEY, legacy_value text);
    CREATE TABLE inventory (
      id integer PRIMARY KEY,
      quantity integer NOT NULL,
      cost_price numeric NOT NULL,
      created_at timestamptz NOT NULL,
      legacy_value text
    );
    CREATE TABLE stock_movements (
      id serial PRIMARY KEY,
      inventory_id integer NOT NULL,
      delta integer NOT NULL,
      reason text NOT NULL,
      reference_table text,
      reference_id integer,
      unit_cost numeric,
      notes text,
      created_at timestamptz NOT NULL,
      legacy_value text
    );

    INSERT INTO estimate_items VALUES (1, 'keep estimate', 123.45);
    INSERT INTO repair_order_work_items VALUES (1, 'keep repair work', 67.89);
    INSERT INTO invoice_items VALUES (1, 'keep invoice', 210.00);
    INSERT INTO shop_settings VALUES (1, 'keep shop settings');
    INSERT INTO inventory VALUES
      (1, 3, 42.50, '2026-09-01T10:00:00Z', 'keep positive inventory'),
      (2, 0, 15.00, '2026-09-02T10:00:00Z', 'keep zero inventory'),
      (3, 7, 9.99, '2026-09-03T10:00:00Z', 'keep inventory with movement history'),
      (4, -2, 18.75, '2026-09-04T10:00:00Z', 'keep negative inventory');
    INSERT INTO stock_movements
      (id, inventory_id, delta, reason, notes, created_at, legacy_value)
    VALUES
      (10, 2, -1, 'manual_adjustment', 'keep prior stock history',
       '2026-08-01T10:00:00Z', 'keep movement'),
      (11, 3, 2, 'purchase_received', 'existing positive-item history',
       '2026-08-02T10:00:00Z', 'keep positive-item movement');
  `);
});

after(() => {
  if (postgresStarted) {
    execFileSync("pg_ctl", ["-D", dataDirectory, "-m", "immediate", "-w", "stop"]);
  }
  if (dataDirectory) {
    rmSync(path.dirname(dataDirectory), { recursive: true, force: true });
  }
});

function declaredColumnsFromSql(sql: string) {
  const columns: Array<{ table: string; column: string }> = [];

  for (const statement of sql.matchAll(/ALTER TABLE\s+([a-z_]+)([\s\S]*?);/gi)) {
    const table = statement[1].toLowerCase();
    for (const column of statement[2].matchAll(
      /ADD COLUMN(?:\s+IF NOT EXISTS)?\s+([a-z_][a-z0-9_]*)/gi,
    )) {
      columns.push({ table, column: column[1].toLowerCase() });
    }
  }

  return columns;
}

function legacyDataSnapshot(database = databaseUrl) {
  return psql(`
    SELECT jsonb_build_object(
      'estimate', (SELECT to_jsonb(row_data) FROM
        (SELECT id, description, amount FROM estimate_items WHERE id = 1) row_data),
      'repairWork', (SELECT to_jsonb(row_data) FROM
        (SELECT id, description, amount FROM repair_order_work_items WHERE id = 1) row_data),
      'invoice', (SELECT to_jsonb(row_data) FROM
        (SELECT id, description, amount FROM invoice_items WHERE id = 1) row_data),
      'shopSettings', (SELECT to_jsonb(row_data) FROM
        (SELECT id, legacy_value FROM shop_settings WHERE id = 1) row_data),
      'inventory', (SELECT jsonb_agg(to_jsonb(row_data) ORDER BY id) FROM
        (SELECT id, quantity, cost_price, created_at, legacy_value FROM inventory) row_data),
      'stockMovement', (SELECT to_jsonb(row_data) FROM
        (SELECT id, inventory_id, delta, reason, notes, created_at, legacy_value
         FROM stock_movements WHERE id = 10) row_data),
      'positiveItemMovement', (SELECT to_jsonb(row_data) FROM
        (SELECT id, inventory_id, delta, reason, notes, created_at, legacy_value
         FROM stock_movements WHERE id = 11) row_data)
    )::text;
  `, database);
}

test("Render startup migrations apply all declared SQL columns twice without changing existing rows", () => {
  const expectedColumns = migrations.flatMap((migrationPath) =>
    declaredColumnsFromSql(readFileSync(migrationPath, "utf8")),
  );
  assert.ok(expectedColumns.length > 0, "the SQL migration files must declare columns");

  const beforeMigration = legacyDataSnapshot();
  const migrationCode = `
    import { runRenderSchemaMigrations } from ${JSON.stringify(migrationBundlePath)};
    await runRenderSchemaMigrations();
    await runRenderSchemaMigrations();
    process.exit(0);
  `;
  run(
    process.execPath,
    ["--input-type=module", "-e", migrationCode],
    {
      ...process.env,
      DATABASE_URL: databaseUrl,
      NODE_ENV: "production",
      RENDER: "true",
    },
  );

  const expectedColumnList = expectedColumns
    .map(({ table, column }) => `('${table}', '${column}')`)
    .join(", ");
  const actualColumnCount = Number(
    psql(`
      SELECT count(*)
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND (table_name, column_name) IN (${expectedColumnList});
    `),
  );
  assert.equal(actualColumnCount, expectedColumns.length);
  assert.equal(
    psql(`
      SELECT count(*)
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name IN ('auth_sessions', 'auth_login_attempts');
    `),
    "2",
    "Render startup creates the shared session and login-attempt stores",
  );

  assert.equal(legacyDataSnapshot(), beforeMigration);
  const afterFirstRun = psql(`
    SELECT jsonb_build_object(
      'stockMovements', (SELECT jsonb_agg(to_jsonb(row_data) ORDER BY id) FROM
        (SELECT id, inventory_id, delta, reason, reference_table, reference_id,
                unit_cost, notes, effective_date, created_at, legacy_value
         FROM stock_movements) row_data),
      'ownerFundingEntries', (SELECT count(*) FROM owner_funding_entries)
    )::text;
  `);
  assert.equal(psql(`
    SELECT count(*)
    FROM stock_movements
    WHERE reason = 'opening_balance' AND inventory_id = 1;
  `), "1");
  assert.equal(
    psql(`
      SELECT delta || '|' || unit_cost::text || '|' || effective_date::text || '|'
        || reference_table || '|' || reference_id::text || '|' || created_at::date::text
      FROM stock_movements
      WHERE reason = 'opening_balance' AND inventory_id = 1;
    `),
    "3|42.50|2026-09-01|inventory|1|2026-09-01",
    "opening stock preserves quantity, cost, inventory reference, and the inventory creation date",
  );
  assert.equal(
    psql(`
      SELECT string_agg(id::text || ':' || effective_date::text, ',' ORDER BY id)
      FROM stock_movements WHERE id IN (10, 11);
    `),
    "10:2026-08-01,11:2026-08-02",
    "existing movement rows receive their own creation date",
  );
  assert.equal(
    psql(`
      SELECT count(*) FROM stock_movements
      WHERE reason = 'opening_balance' AND inventory_id IN (2, 3, 4);
    `),
    "0",
    "zero, negative, and already-historied items do not receive synthetic opening movements",
  );

  run(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", migrationCode],
    {
      ...process.env,
      DATABASE_URL: databaseUrl,
      NODE_ENV: "production",
      RENDER: "true",
    },
  );
  assert.equal(legacyDataSnapshot(), beforeMigration);
  assert.equal(
    psql(`
      SELECT jsonb_build_object(
        'stockMovements', (SELECT jsonb_agg(to_jsonb(row_data) ORDER BY id) FROM
          (SELECT id, inventory_id, delta, reason, reference_table, reference_id,
                  unit_cost, notes, effective_date, created_at, legacy_value
           FROM stock_movements) row_data),
        'ownerFundingEntries', (SELECT count(*) FROM owner_funding_entries)
      )::text;
    `),
    afterFirstRun,
  );
});

test("simultaneous Render startups serialize on the advisory lock and preserve existing rows", async () => {
  const concurrencyDatabase = `postgresql://postgres@127.0.0.1:${pgPort}/migration_concurrency`;
  const firstApplication = "render-migration-concurrency-first";
  const secondApplication = "render-migration-concurrency-second";
  const lockHolderApplication = "render-migration-concurrency-table-lock";
  run("createdb", ["-h", "127.0.0.1", "-p", String(pgPort), "-U", "postgres", "migration_concurrency"]);
  psql(`
    CREATE TABLE employees (id serial PRIMARY KEY);
    CREATE TABLE estimate_items (id integer PRIMARY KEY, description text, amount numeric);
    CREATE TABLE repair_order_work_items (id integer PRIMARY KEY, description text, amount numeric);
    CREATE TABLE invoice_items (id integer PRIMARY KEY, description text, amount numeric);
    CREATE TABLE shop_settings (id integer PRIMARY KEY, legacy_value text);
    CREATE TABLE inventory (
      id integer PRIMARY KEY,
      quantity integer NOT NULL,
      cost_price numeric NOT NULL,
      created_at timestamptz NOT NULL,
      legacy_value text
    );
    CREATE TABLE stock_movements (
      id serial PRIMARY KEY,
      inventory_id integer NOT NULL,
      delta integer NOT NULL,
      reason text NOT NULL,
      reference_table text,
      reference_id integer,
      unit_cost numeric,
      notes text,
      created_at timestamptz NOT NULL,
      legacy_value text
    );
    INSERT INTO estimate_items VALUES (1, 'keep estimate', 123.45);
    INSERT INTO repair_order_work_items VALUES (1, 'keep repair work', 67.89);
    INSERT INTO invoice_items VALUES (1, 'keep invoice', 210.00);
    INSERT INTO shop_settings VALUES (1, 'keep shop settings');
    INSERT INTO inventory VALUES
      (1, 3, 42.50, '2026-09-01T10:00:00Z', 'keep positive inventory'),
      (2, 0, 15.00, '2026-09-02T10:00:00Z', 'keep zero inventory'),
      (3, 7, 9.99, '2026-09-03T10:00:00Z', 'keep inventory with movement history'),
      (4, -2, 18.75, '2026-09-04T10:00:00Z', 'keep negative inventory');
    INSERT INTO stock_movements
      (id, inventory_id, delta, reason, notes, created_at, legacy_value)
    VALUES
      (10, 2, -1, 'manual_adjustment', 'keep prior stock history',
       '2026-08-01T10:00:00Z', 'keep movement'),
      (11, 3, 2, 'purchase_received', 'existing positive-item history',
       '2026-08-02T10:00:00Z', 'keep positive-item movement');
  `, concurrencyDatabase);
  const beforeMigration = legacyDataSnapshot(concurrencyDatabase);

  const lockHolder = spawn(
    "psql",
    [
      concurrencyDatabase,
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "BEGIN; LOCK TABLE shop_settings IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(120);",
    ],
    {
      cwd: apiRoot,
      env: {
        ...process.env,
        PGAPPNAME: lockHolderApplication,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const lockHolderExit = new Promise<{ code: number | null; error?: Error }>((resolve) => {
    lockHolder.once("error", (error) => resolve({ code: null, error }));
    lockHolder.once("close", (code) => resolve({ code }));
  });

  let firstStartup: ReturnType<typeof startRenderStartup> | undefined;
  let secondStartup: ReturnType<typeof startRenderStartup> | undefined;
  try {
    await waitForDatabaseCondition(
      `SELECT count(*) FROM pg_locks locks
       JOIN pg_stat_activity activity ON activity.pid = locks.pid
       JOIN pg_class relation ON relation.oid = locks.relation
       WHERE activity.application_name = '${lockHolderApplication}'
         AND relation.relname = 'shop_settings'
         AND locks.mode = 'AccessExclusiveLock'
         AND locks.granted;`,
      concurrencyDatabase,
      "the test lock holder acquired the shop_settings table lock",
    );

    firstStartup = startRenderStartup(concurrencyDatabase, firstApplication);
    await waitForDatabaseCondition(
      `SELECT count(*) FROM pg_stat_activity
       WHERE application_name = '${firstApplication}'
         AND state = 'active'
         AND wait_event_type = 'Lock'
         AND query LIKE 'ALTER TABLE shop_settings%';`,
      concurrencyDatabase,
      "the first startup holds the migration lock and is paused at shop_settings",
    );

    secondStartup = startRenderStartup(concurrencyDatabase, secondApplication);
    await waitForDatabaseCondition(
      `SELECT count(*) FROM pg_stat_activity
       WHERE application_name = '${secondApplication}'
         AND state = 'active'
         AND wait_event_type = 'Lock'
         AND wait_event = 'advisory'
         AND query LIKE 'SELECT pg_advisory_lock%';`,
      concurrencyDatabase,
      "the second startup is waiting on the PostgreSQL advisory migration lock",
    );
  } finally {
    try {
      psql(
        `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
         WHERE application_name = '${lockHolderApplication}'
           AND datname = current_database();`,
        concurrencyDatabase,
      );
    } finally {
      const [holderResult] = await Promise.all([
        lockHolderExit,
        ...(firstStartup ? [firstStartup] : []),
        ...(secondStartup ? [secondStartup] : []),
      ]);
      if (holderResult.error) throw holderResult.error;
    }
  }

  assert.ok(firstStartup, "the first independent startup process was launched");
  assert.ok(secondStartup, "the second independent startup process was launched");
  const [firstResult, secondResult] = await Promise.all([firstStartup, secondStartup]);
  if (!firstResult.ok) assert.fail(`first startup failed: ${String(firstResult.error)}`);
  if (!secondResult.ok) assert.fail(`second startup failed: ${String(secondResult.error)}`);
  assert.match(firstResult.output, /STARTUP_READY/);
  assert.match(secondResult.output, /STARTUP_READY/);

  const expectedColumns = migrations.flatMap((migrationPath) =>
    declaredColumnsFromSql(readFileSync(migrationPath, "utf8")),
  );
  const expectedColumnList = expectedColumns
    .map(({ table, column }) => `('${table}', '${column}')`)
    .join(", ");
  assert.equal(
    Number(psql(`
      SELECT count(*)
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND (table_name, column_name) IN (${expectedColumnList});
    `, concurrencyDatabase)),
    expectedColumns.length,
    "both startups leave all migration columns in place",
  );
  assert.equal(legacyDataSnapshot(concurrencyDatabase), beforeMigration);
  assert.equal(
    psql(`
      SELECT count(*) FROM stock_movements
      WHERE reason = 'opening_balance' AND inventory_id = 1;
    `, concurrencyDatabase),
    "1",
    "the concurrent startups add the opening movement exactly once",
  );
  assert.equal(
    psql("SELECT count(*) FROM stock_movements WHERE effective_date IS NULL;", concurrencyDatabase),
    "0",
    "all existing movements receive an effective date",
  );
});

test("the standalone SQL migration matches the opening-stock behavior", () => {
  run("createdb", ["-h", "127.0.0.1", "-p", String(pgPort), "-U", "postgres", "opening_sql"]);
  const sqlDatabaseUrl = `postgresql://postgres@127.0.0.1:${pgPort}/opening_sql`;
  psql(`
    CREATE TABLE inventory (
      id integer PRIMARY KEY,
      quantity integer NOT NULL,
      cost_price numeric(10, 2) NOT NULL,
      created_at timestamp NOT NULL
    );
    CREATE TABLE stock_movements (
      id serial PRIMARY KEY,
      inventory_id integer NOT NULL,
      delta integer NOT NULL,
      reason text NOT NULL,
      reference_table text,
      reference_id integer,
      unit_cost numeric(10, 2),
      notes text,
      created_at timestamp NOT NULL
    );
    INSERT INTO inventory VALUES
      (1, 4, 17.25, '2026-05-01 08:30:00'),
      (2, 8, 11.00, '2026-05-02 09:30:00'),
      (3, 0, 3.00, '2026-05-03 10:30:00');
    INSERT INTO stock_movements (inventory_id, delta, reason, created_at)
    VALUES (2, 2, 'purchase_received', '2026-04-29 12:00:00');
  `, sqlDatabaseUrl);
  run("psql", [
    sqlDatabaseUrl,
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-f",
    openingStockMigration,
  ]);
  run("psql", [
    sqlDatabaseUrl,
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-f",
    openingStockMigration,
  ]);

  assert.equal(
    psql(`
      SELECT count(*) || '|' || min(delta)::text || '|' || min(unit_cost)::text || '|'
        || min(effective_date)::text
      FROM stock_movements WHERE reason = 'opening_balance';
    `, sqlDatabaseUrl),
    "1|4|17.25|2026-05-01",
  );
  assert.equal(
    psql("SELECT effective_date::text FROM stock_movements WHERE inventory_id = 2", sqlDatabaseUrl),
    "2026-04-29",
    "existing history is retained and gets its original date",
  );
});

test("a later startup resumes the effective-date backfill after a committed batch", async () => {
  run("createdb", ["-h", "127.0.0.1", "-p", String(pgPort), "-U", "postgres", "migration_retry"]);
  const retryDatabaseUrl = `postgresql://postgres@127.0.0.1:${pgPort}/migration_retry`;
  psql(`
    CREATE TABLE employees (id serial PRIMARY KEY);
    CREATE TABLE estimate_items (id integer PRIMARY KEY);
    CREATE TABLE repair_order_work_items (id integer PRIMARY KEY);
    CREATE TABLE invoice_items (id integer PRIMARY KEY);
    CREATE TABLE shop_settings (id integer PRIMARY KEY);
    CREATE TABLE inventory (
      id integer PRIMARY KEY,
      quantity integer NOT NULL,
      cost_price numeric(10, 2) NOT NULL,
      created_at timestamptz NOT NULL
    );
    CREATE TABLE stock_movements (
      id serial PRIMARY KEY,
      inventory_id integer NOT NULL,
      delta integer NOT NULL,
      reason text NOT NULL,
      reference_table text,
      reference_id integer,
      unit_cost numeric(10, 2),
      notes text,
      created_at timestamptz NOT NULL,
      legacy_value text
    );
    INSERT INTO inventory VALUES
      (1, 5, 12.50, '2026-09-01T10:00:00Z'),
      (2, 1, 7.25, '2026-09-02T10:00:00Z');
    INSERT INTO stock_movements
      (id, inventory_id, delta, reason, reference_table, reference_id, unit_cost,
       notes, created_at, legacy_value)
    SELECT id, 2, CASE WHEN id % 2 = 0 THEN 1 ELSE -1 END, 'existing_history',
           'purchase', 17, 7.25, 'preserve movement history',
           '2026-08-01T00:00:00Z'::timestamptz + id * interval '1 second',
           'legacy-' || id::text
    FROM generate_series(1, 100001) AS id;
    SELECT setval(pg_get_serial_sequence('stock_movements', 'id'), 100001);

    CREATE FUNCTION fail_late_movement_backfill() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.id > 100000 THEN
        RAISE EXCEPTION 'injected effective-date backfill failure';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER fail_late_movement_backfill
      BEFORE UPDATE ON stock_movements
      FOR EACH ROW EXECUTE FUNCTION fail_late_movement_backfill();
  `, retryDatabaseUrl);

  const historySnapshot = () => psql(`
    SELECT md5(string_agg(to_jsonb(row_data)::text, E'\\n' ORDER BY id))
    FROM (
      SELECT id, inventory_id, delta, reason, reference_table, reference_id,
             unit_cost, notes, created_at, legacy_value
      FROM stock_movements
      WHERE reason <> 'opening_balance'
    ) row_data;
  `, retryDatabaseUrl);
  const originalHistory = historySnapshot();

  const failedStartup = await startRenderStartup(retryDatabaseUrl, "render-migration-retry-failed");
  assert.equal(failedStartup.ok, false, "startup must abort when a later backfill batch fails");
  assert.match(String(failedStartup.error), /Server startup aborted/);
  assert.match(String(failedStartup.error), /injected effective-date backfill failure/);
  assert.doesNotMatch(String(failedStartup.error), /STARTUP_READY/);
  assert.equal(
    psql(`
      SELECT count(*) FILTER (WHERE effective_date IS NOT NULL)::text || '|'
        || count(*) FILTER (WHERE effective_date IS NULL)::text
      FROM stock_movements;
    `, retryDatabaseUrl),
    "100000|1",
    "the earlier batch remains committed while the failing batch is rolled back",
  );
  assert.equal(historySnapshot(), originalHistory, "the failed attempt preserves movement history");

  psql(`
    DROP TRIGGER fail_late_movement_backfill ON stock_movements;
    DROP FUNCTION fail_late_movement_backfill();
  `, retryDatabaseUrl);

  const retriedStartup = await startRenderStartup(retryDatabaseUrl, "render-migration-retry-success");
  assert.equal(retriedStartup.ok, true, `retry startup should succeed: ${String(retriedStartup.error)}`);
  assert.match(retriedStartup.output, /STARTUP_READY/);
  assert.equal(
    psql(`
      SELECT count(*) FILTER (WHERE effective_date IS NULL)::text || '|'
        || count(*) FILTER (WHERE effective_date IS DISTINCT FROM created_at::date)::text
      FROM stock_movements;
    `, retryDatabaseUrl),
    "0|0",
    "the retry fills every effective date with its movement's original creation date",
  );
  assert.equal(historySnapshot(), originalHistory, "the successful retry preserves existing movements");
  assert.equal(
    psql(`
      SELECT count(*) FROM stock_movements
      WHERE reason = 'opening_balance' AND inventory_id = 1;
    `, retryDatabaseUrl),
    "1",
    "the retry creates the missing inventory opening movement once",
  );

  const movementsAfterRetry = Number(psql("SELECT count(*) FROM stock_movements;", retryDatabaseUrl));
  const secondSuccessfulStartup = await startRenderStartup(
    retryDatabaseUrl,
    "render-migration-retry-idempotent",
  );
  assert.equal(secondSuccessfulStartup.ok, true);
  assert.equal(
    Number(psql("SELECT count(*) FROM stock_movements;", retryDatabaseUrl)),
    movementsAfterRetry,
    "a subsequent startup does not duplicate the opening movement",
  );
  assert.equal(
    psql(`
      SELECT count(*) FROM stock_movements
      WHERE reason = 'opening_balance' AND inventory_id = 1;
    `, retryDatabaseUrl),
    "1",
  );
});

test("the Render backfill completes on 100k synthetic inventory and 1M movement rows", async (t) => {
  run("createdb", ["-h", "127.0.0.1", "-p", String(pgPort), "-U", "postgres", "migration_scale"]);
  const scaleDatabaseUrl = `postgresql://postgres@127.0.0.1:${pgPort}/migration_scale`;
  psql(`
    CREATE TABLE employees (id serial PRIMARY KEY);
    CREATE TABLE estimate_items (id integer PRIMARY KEY);
    CREATE TABLE repair_order_work_items (id integer PRIMARY KEY);
    CREATE TABLE invoice_items (id integer PRIMARY KEY);
    CREATE TABLE shop_settings (id integer PRIMARY KEY);
    CREATE TABLE inventory (
      id integer PRIMARY KEY,
      quantity integer NOT NULL,
      cost_price numeric(10, 2) NOT NULL,
      created_at timestamp NOT NULL
    );
    CREATE TABLE stock_movements (
      id serial PRIMARY KEY,
      inventory_id integer NOT NULL,
      delta integer NOT NULL,
      reason text NOT NULL,
      reference_table text,
      reference_id integer,
      reference_line_id integer,
      unit_cost numeric(10, 2),
      notes text,
      created_at timestamp NOT NULL
    );
    CREATE INDEX stock_movements_inventory_id_idx ON stock_movements(inventory_id);
    CREATE INDEX stock_movements_reference_idx ON stock_movements(reference_table, reference_id);
    CREATE INDEX stock_movements_source_idx
      ON stock_movements(inventory_id, reference_table, reference_id, reference_line_id, reason);

    INSERT INTO inventory
    SELECT id,
           CASE WHEN id % 17 = 0 THEN 0 ELSE 1 + id % 19 END,
           (id % 10000)::numeric / 100,
           timestamp '2020-01-01 00:00:00' + id * interval '1 hour'
    FROM generate_series(1, 100000) AS id;

    INSERT INTO stock_movements
      (inventory_id, delta, reason, reference_table, reference_id, reference_line_id,
       unit_cost, notes, created_at)
    SELECT 2 + ((n - 1) / 20) * 2,
           CASE WHEN n % 2 = 0 THEN 1 ELSE -1 END,
           CASE WHEN n % 2 = 0 THEN 'purchase_received' ELSE 'manual_adjustment' END,
           'benchmark', ((n - 1) / 20) + 1, n % 20,
           ((n % 10000)::numeric / 100),
           'synthetic benchmark history',
           timestamp '2024-01-01 00:00:00' + n * interval '1 minute'
    FROM generate_series(1, 1000000) AS n;
    ANALYZE inventory;
    ANALYZE stock_movements;
  `, scaleDatabaseUrl);

  const baselineStart = Date.now();
  const lookupPlan = psql(
    "EXPLAIN (FORMAT TEXT) SELECT count(*) FROM stock_movements WHERE id = 1",
    scaleDatabaseUrl,
  );
  run("psql", [
    scaleDatabaseUrl,
    "-X",
    "-qAt",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    "SELECT /* opening-stock-lock-probe */ count(*) FROM stock_movements WHERE id = 1",
  ]);
  const baselineReadMs = Date.now() - baselineStart;

  const migrationCode = `
    import { runRenderSchemaMigrations } from ${JSON.stringify(migrationBundlePath)};
    await runRenderSchemaMigrations();
    process.exit(0);
  `;
  const migrationStart = Date.now();
  let migrationFinished = false;
  const migrationPromise = runAsync(
    process.execPath,
    ["--input-type=module", "-e", migrationCode],
    {
      ...process.env,
      DATABASE_URL: scaleDatabaseUrl,
      NODE_ENV: "production",
      RENDER: "true",
    },
  ).then((output) => {
    migrationFinished = true;
    return output;
  });

  const updateDeadline = Date.now() + 120_000;
  let sawBackfillUpdate = false;
  while (Date.now() < updateDeadline && !migrationFinished) {
    if (psql(`
      SELECT count(*)
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND state = 'active'
        AND query LIKE 'WITH batch AS%';
    `, scaleDatabaseUrl) === "1") {
      sawBackfillUpdate = true;
      break;
    }
    await delay(10);
  }
  assert.ok(sawBackfillUpdate, "observed the movement-date backfill in progress");

  const blockedReadStart = Date.now();
  let readFinished = false;
  let blockedReadDurationMs: number | null = null;
  const probeEnvironment = {
    ...process.env,
    PGAPPNAME: "opening-stock-lock-probe",
  };
  const blockedReadPromise = runAsync("psql", [
    scaleDatabaseUrl,
    "-X",
    "-qAt",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    "SELECT /* opening-stock-lock-probe */ count(*) FROM stock_movements WHERE id = 1",
  ], probeEnvironment).then((output) => {
    blockedReadDurationMs = Date.now() - blockedReadStart;
    readFinished = true;
    return output;
  });

  let observedLockWait = false;
  const observedWaitEvents = new Set<string>();
  const lockDeadline = Date.now() + 60_000;
  while (Date.now() < lockDeadline && !readFinished) {
    const waitState = psql(`
      SELECT coalesce(wait_event_type, 'none') || ':' || coalesce(wait_event, 'none')
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND application_name = 'opening-stock-lock-probe'
        AND state = 'active'
      LIMIT 1;
    `, scaleDatabaseUrl);
    if (waitState) {
      observedWaitEvents.add(waitState);
      if (waitState.startsWith("Lock:")) observedLockWait = true;
    }
    await delay(10);
  }

  const [migrationOutput, blockedReadResult] = await Promise.all([
    migrationPromise,
    blockedReadPromise,
  ]);
  const migrationMs = Date.now() - migrationStart;
  const migrationLogs = parseJsonLogLines(migrationOutput);
  const phases = [
    "schema preparation",
    "effective-date backfill",
    "effective-date constraint",
    "opening-stock movements",
  ];
  for (const phase of phases) {
    assert.ok(
      migrationLogs.some(
        (entry) =>
          entry.msg === "Render schema migration phase started" &&
          entry.phase === phase &&
          Number.isFinite(entry.elapsedMs),
      ),
      `logged the start of the ${phase} phase`,
    );
    assert.ok(
      migrationLogs.some(
        (entry) =>
          entry.msg === "Render schema migration phase completed" &&
          entry.phase === phase &&
          Number.isFinite(entry.elapsedMs),
      ),
      `logged the completion time of the ${phase} phase`,
    );
  }
  const backfillBatchLogs = migrationLogs.filter(
    (entry) => entry.msg === "Render stock movement date backfill batch completed",
  );
  assert.ok(backfillBatchLogs.length >= 10, "logged progress for each backfill batch");
  assert.equal(backfillBatchLogs.at(-1).rowsUpdated, 0);
  assert.equal(backfillBatchLogs.at(-1).totalRowsUpdated, 1_000_000);
  for (const entry of backfillBatchLogs) {
    assert.equal(typeof entry.batch, "number");
    assert.equal(typeof entry.rowsUpdated, "number");
    assert.equal(typeof entry.totalRowsUpdated, "number");
    assert.equal(Number.isFinite(entry.elapsedMs), true);
    assert.equal("inventoryId" in entry, false);
    assert.equal("customerId" in entry, false);
  }
  const movementCounts = psql(`
    SELECT (SELECT count(*) FROM stock_movements WHERE reason = 'opening_balance')
      || '|' || (SELECT count(*) FROM stock_movements WHERE effective_date IS NULL)
      || '|' || (SELECT count(*) FROM stock_movements);
  `, scaleDatabaseUrl);
  assert.equal(movementCounts, "47059|0|1047059");
  assert.equal(Number(blockedReadResult), 1);
  assert.ok(blockedReadDurationMs !== null);
  assert.ok(
    blockedReadDurationMs < 5_000,
    `the indexed read should not stall behind the backfill (actual ${blockedReadDurationMs}ms)`,
  );
  assert.equal(
    observedLockWait,
    false,
    "ordinary reads should not wait on a table lock during the date backfill",
  );
  t.diagnostic(
    `synthetic scale: inventory=100000, prior movements=1000000; ` +
    `startup migration=${migrationMs}ms; primary-key movement lookup baseline=${baselineReadMs}ms, ` +
    `during migration=${blockedReadDurationMs}ms; PostgreSQL wait events=${[...observedWaitEvents].join(",") || "none"}; ` +
    `lookup plan=${lookupPlan.replaceAll("\n", " / ")}`,
  );
});

test("a failed startup migration logs an abort and never starts the listener", () => {
  run("createdb", ["-h", "127.0.0.1", "-p", String(pgPort), "-U", "postgres", "migration_failure"]);
  const failureDatabaseUrl = `postgresql://postgres@127.0.0.1:${pgPort}/migration_failure`;
  psql(
    `
      CREATE TABLE estimate_items (id integer PRIMARY KEY);
      CREATE TABLE employees (id serial PRIMARY KEY);
      CREATE TABLE repair_order_work_items (id integer PRIMARY KEY);
      CREATE TABLE invoice_items (id integer PRIMARY KEY);
      CREATE TABLE shop_settings (id integer PRIMARY KEY);
    `,
    failureDatabaseUrl,
  );
  const failureCode = `
    import { runRenderSchemaMigrations } from ${JSON.stringify(migrationBundlePath)};
    import { startAfterSchemaMigrations } from "./src/lib/startup.ts";
    const events = [];
    const errors = [];
    await startAfterSchemaMigrations({
      runMigrations: runRenderSchemaMigrations,
      start: () => events.push("listener started"),
      logger: { error: (details, message) => errors.push({ error: String(details.err), message }) },
      exit: (code) => events.push("exit " + code),
    });
    console.log("STARTUP_RESULT=" + JSON.stringify({ events, errors }));
    process.exit(0);
  `;
  const output = run(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", failureCode],
    {
      ...process.env,
      DATABASE_URL: failureDatabaseUrl,
      NODE_ENV: "production",
      RENDER: "true",
    },
  );

  assert.match(output, /Render schema migration failed/);
  const resultLine = output.split("\n").find((line) => line.startsWith("STARTUP_RESULT="));
  assert.ok(resultLine, "startup gate should report its result");
  const result = JSON.parse(resultLine.slice("STARTUP_RESULT=".length));
  assert.deepEqual(result.events, ["exit 1"]);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].message, "Server startup aborted");
  assert.match(result.errors[0].error, /relation "inventory" does not exist/);
  assert.equal(
    psql(
      `
        SELECT count(*)
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND (table_name, column_name) IN (
            ('estimate_items', 'price_includes_tax'),
            ('repair_order_work_items', 'price_includes_tax'),
            ('invoice_items', 'price_includes_tax'),
            ('shop_settings', 'shop_name')
          );
      `,
      failureDatabaseUrl,
    ),
    "0",
    "a failed startup migration must roll back earlier statements",
  );
});

test("the startup gate starts the listener only after migration success", async () => {
  const events: string[] = [];
  await startAfterSchemaMigrations({
    runMigrations: async () => {
      events.push("migrations complete");
    },
    start: () => events.push("listener started"),
    logger: { error: () => assert.fail("successful migrations should not log an error") },
    exit: () => assert.fail("successful migrations should not exit"),
  });

  assert.deepEqual(events, ["migrations complete", "listener started"]);
});