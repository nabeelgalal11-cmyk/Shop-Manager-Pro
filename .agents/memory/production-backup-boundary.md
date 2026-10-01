---
name: Production backup boundary
description: Preserve host separation for production PostgreSQL dumps and Google Drive uploads.
---

Daily production PostgreSQL backups should run through the scheduled GitHub Actions workflow in a private repository. The user chose this to avoid Render billing and accepted GitHub Actions secrets as private from the public; the GitHub runner still handles the production URL at run time. Use Render's external connection URL for the live database, not its private/internal hostname, Replit's URL, or the separate `NEON_DATABASE_URL`. Store the URL and upload token only as GitHub Actions repository secrets; never send the production URL to Replit. Limit repository write access to trusted workflow editors. The Replit deployment remains an authenticated relay that uploads verified dump bytes to connected Google Drive. HostGator Linux Shared currently lacks `pg_dump` and `pg_restore`. Keep dated backups unless the user requests retention or deletion.

**Why:** The user does not want to add a payment card to Render, and HostGator Shared lacks the PostgreSQL client tools required for a complete dump. GitHub Actions' included runner allowance avoids a Render Cron service while Replit retains the Drive connector.

**How to apply:** Keep the GitHub repository private, configure the external Render database URL and receiver token as repository secrets, and do not add pull-request triggers or print secrets. GitHub Actions may block further runs if the included monthly minutes are exhausted without a payment method. PHP query access is not a substitute for a complete `pg_dump` archive.