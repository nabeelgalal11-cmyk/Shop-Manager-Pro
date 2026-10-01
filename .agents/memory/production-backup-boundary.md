---
name: Production backup boundary
description: Preserve host separation for production PostgreSQL dumps and Google Drive uploads.
---

Daily production PostgreSQL backups should run in the Render Cron Docker job. The user chose this after confirming their HostGator Linux Shared cPanel account lacks `pg_dump` and `pg_restore`; HostGator also documents PostgreSQL service as unavailable on Shared hosting. Use the live Render service's `DATABASE_URL`, not Replit's URL or the separate `NEON_DATABASE_URL`. Keep the production database URL only on Render, never in Replit. The Replit deployment remains an authenticated relay that uploads verified dump bytes to connected Google Drive. Keep dated backups unless the user requests retention or deletion.

**Why:** HostGator Shared lacks the PostgreSQL client tools required to produce a complete dump, and PHP query access would not substitute for a full `pg_dump` archive. Render's Docker job supplies compatible PostgreSQL tools while Replit retains the Drive connector.

**How to apply:** Configure the existing Render Cron Docker job with Render's production `DATABASE_URL`, the backup upload token, and the Replit receiver URL. PHP may connect to a PostgreSQL database only if its `pdo_pgsql`/`pgsql` extension and network access are available, but do not use the separate Neon URL for this production backup.