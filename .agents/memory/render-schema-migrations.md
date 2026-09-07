---
name: Render schema migration
description: Production schema migration constraint for the external Render deployment
---

Render Free does not provide a separate migration phase for this service. Narrow, additive schema changes that must reach the Render database use the guarded Render-only startup migration path, protected by a PostgreSQL advisory transaction lock.

**Why:** The deployed service and its database can be updated independently; publishing the Replit workspace does not apply schema changes to the external Render database, and the free plan does not expose a separate migration command.

**How to apply:** Keep startup migrations limited to idempotent additive changes, detect Render explicitly, run before accepting traffic, and abort startup if the migration fails. Do not use this path for destructive or data-rewriting changes.