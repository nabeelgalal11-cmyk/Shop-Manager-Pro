import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
const migrations = [
  path.join(
    workspaceRoot,
    "lib/db/migrations/2026-09-07_estimate_part_price_includes_tax.sql",
  ),
  path.join(
    workspaceRoot,
    "lib/db/migrations/2026-09-07_shop_business_information.sql",
  ),
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
      (2, 0, 15.00, '2026-09-02T10:00:00Z', 'keep zero inventory');
    INSERT INTO stock_movements
      (id, inventory_id, delta, reason, notes, created_at, legacy_value)
    VALUES
      (10, 2, -1, 'manual_adjustment', 'keep prior stock history',
       '2026-08-01T10:00:00Z', 'keep movement');
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

function legacyDataSnapshot() {
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
         FROM stock_movements WHERE id = 10) row_data)
    )::text;
  `);
}

test("Render startup migrations apply the columns declared by both SQL migrations twice without changing existing rows", () => {
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

test("a failed startup migration logs an abort and never starts the listener", () => {
  run("createdb", ["-h", "127.0.0.1", "-p", String(pgPort), "-U", "postgres", "migration_failure"]);
  const failureDatabaseUrl = `postgresql://postgres@127.0.0.1:${pgPort}/migration_failure`;
  psql(
    `
      CREATE TABLE estimate_items (id integer PRIMARY KEY);
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