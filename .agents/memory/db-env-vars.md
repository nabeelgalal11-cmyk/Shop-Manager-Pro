---
name: DB env vars
description: Which env var the API server uses for Postgres vs the Neon console URL
---

The API server (`lib/db/src/index.ts`) connects using `DATABASE_URL`, not `NEON_DATABASE_URL`.

**Why:** The project has two DB-related env vars. `NEON_DATABASE_URL` is the console/management URL (used by tools like psql in the shell by default). `DATABASE_URL` is what the running application connects to. They point to different Neon endpoints and may differ in schema state.

**How to apply:** When running migrations or any DDL that must be visible to the running API server, always target `DATABASE_URL`:
```
psql "$DATABASE_URL" -f migration.sql
```
Running against `NEON_DATABASE_URL` will silently succeed but leave the app's live DB untouched, causing "column does not exist" errors at runtime.

The repository also has an explicit Neon Drizzle config at `artifacts/api-server/drizzle.config.ts`; the production schema command targets `NEON_DATABASE_URL`. Drizzle Kit may still ask table/column rename questions even with `--force`; for an authorized structural reset, choose create rather than rename.

**Why:** Replit’s Publish schema dialog and the project’s Neon schema are separate flows. Mixing them produces duplicate approval prompts and can target the wrong database.

**How to apply:** Sync Neon with the repository’s Drizzle command first, then publish application code. Do not approve Replit-managed database changes when Neon is the application database.
