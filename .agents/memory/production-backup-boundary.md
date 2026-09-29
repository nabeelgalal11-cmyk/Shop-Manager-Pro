---
name: Production backup boundary
description: Preserve host separation for production PostgreSQL dumps and Google Drive uploads.
---

Daily production database backups must run on Render, where the live application uses Render's `DATABASE_URL`. The Replit deployment is only an authenticated relay that uploads verified dump bytes to the connected Google Drive. Never send the production database URL to Replit or substitute Replit's `DATABASE_URL` or the separate `NEON_DATABASE_URL`. Keep dated backups unless the user asks for a retention or deletion policy.

**Why:** The real application is hosted on Render, while the public Replit Autoscale deployment must stay online and owns the Drive connector. Keeping `pg_dump` on Render preserves the production credential boundary without taking the Replit app offline.

**How to apply:** Keep the scheduled job and database credential on Render; send only the dump, filename, and checksum through the token-protected Replit receiver. Do not switch the existing Replit deployment to a scheduled deployment.