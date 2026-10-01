import assert from "node:assert/strict";
import test from "node:test";
import { resolveDevelopmentBackupTarget } from "../src/lib/development-backup-target.js";

const safeTestEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://app:app-password@main-db.neon.tech/appdb?sslmode=require",
  DEVELOPMENT_RESTORE_DATABASE_URL:
    "postgresql://tester:test-password@test-branch.neon.tech/neondb?sslmode=require",
  DEVELOPMENT_RESTORE_TARGET: "test-branch.neon.tech/neondb",
};

test("allows only the separately configured and exactly allowlisted test database", () => {
  const result = resolveDevelopmentBackupTarget(safeTestEnvironment);

  assert.deepEqual(result.target, {
    host: "test-branch.neon.tech",
    database: "neondb",
  });
  assert.equal(result.connectionString, safeTestEnvironment.DEVELOPMENT_RESTORE_DATABASE_URL);
});

test("rejects a missing dedicated test connection", () => {
  const env = { ...safeTestEnvironment, DEVELOPMENT_RESTORE_DATABASE_URL: "" };

  assert.throws(
    () => resolveDevelopmentBackupTarget(env),
    /DEVELOPMENT_RESTORE_DATABASE_URL with a separate endpoint/,
  );
});

test("rejects using the application's primary database host or branch", () => {
  const sameDatabase = {
    ...safeTestEnvironment,
    DEVELOPMENT_RESTORE_DATABASE_URL: safeTestEnvironment.DATABASE_URL,
    DEVELOPMENT_RESTORE_TARGET: "main-db.neon.tech/appdb",
  };
  assert.throws(
    () => resolveDevelopmentBackupTarget(sameDatabase),
    /separate test host or Neon branch/,
  );

  const sameHostDifferentDatabase = {
    ...safeTestEnvironment,
    DEVELOPMENT_RESTORE_DATABASE_URL:
      "postgresql://tester:test-password@main-db.neon.tech/testdb?sslmode=require",
    DEVELOPMENT_RESTORE_TARGET: "main-db.neon.tech/testdb",
  };
  assert.throws(
    () => resolveDevelopmentBackupTarget(sameHostDifferentDatabase),
    /separate test host or Neon branch/,
  );
});

test("rejects a target that does not match the explicit host and database allowlist", () => {
  const env = {
    ...safeTestEnvironment,
    DEVELOPMENT_RESTORE_TARGET: "main-db.neon.tech/appdb",
  };

  assert.throws(
    () => resolveDevelopmentBackupTarget(env),
    /does not match the configured restore endpoint/,
  );
});

test("rejects production mode, Render services, and Render database hosts", () => {
  assert.throws(
    () => resolveDevelopmentBackupTarget({ ...safeTestEnvironment, NODE_ENV: "production" }),
    /only in the non-Render development workspace/,
  );
  assert.throws(
    () => resolveDevelopmentBackupTarget({ ...safeTestEnvironment, RENDER_SERVICE_ID: "srv-production" }),
    /only in the non-Render development workspace/,
  );
  assert.throws(
    () => resolveDevelopmentBackupTarget({
      ...safeTestEnvironment,
      DEVELOPMENT_RESTORE_DATABASE_URL:
        "postgresql://tester:test-password@production.render.com/neondb",
      DEVELOPMENT_RESTORE_TARGET: "production.render.com/neondb",
    }),
    /Render database cannot be used/,
  );
});