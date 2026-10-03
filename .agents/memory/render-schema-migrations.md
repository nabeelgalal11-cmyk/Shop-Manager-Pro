---
name: Render schema migration
description: Production schema migration constraint for the external Render deployment
---

Render Free does not provide a separate migration phase for this service. Narrow, additive schema changes that must reach the Render database use the guarded Render-only startup migration path, protected by a PostgreSQL advisory transaction lock.

**Why:** The deployed service and its database can be updated independently; publishing the Replit workspace does not apply schema changes to the external Render database, and the free plan does not expose a separate migration command.

**How to apply:** Keep startup migrations limited to idempotent additive changes, detect Render explicitly, run before accepting traffic, and abort startup if the migration fails. Do not use this path for destructive or data-rewriting changes.

For integration tests that execute the real migration module, bundle it with esbuild before running it. Direct TSX imports do not reliably expose named exports from the shared CommonJS database package, while the API's production ESM bundle handles that interop.

**Why:** A source-level test failed on the package module boundary even though the production build supports it, so a test using TSX alone would not exercise the module as deployed.

**How to apply:** Build the migration entry point into a temporary ESM bundle using the API server's esbuild settings, then run that bundle against an isolated local PostgreSQL instance.