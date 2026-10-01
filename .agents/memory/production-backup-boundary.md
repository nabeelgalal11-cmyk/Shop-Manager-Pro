---
name: Production backup boundary
description: Preserve host separation for production PostgreSQL dumps and Google Drive uploads.
---

The user prefers HostGator to run daily production database backups instead of Render Cron. The current HostGator plan is Linux Shared cPanel; its tool check found `pg_dump` and `pg_restore` missing. HostGator documents PostgreSQL service as unavailable on Shared hosting. Do not switch the runner unless a compatible PostgreSQL 16+ client and outbound access to Render's external PostgreSQL endpoint are available, or the user upgrades to VPS/Dedicated. Store the production database URL only on the chosen runner, never in Replit. The Replit deployment remains an authenticated relay that uploads verified dump bytes to connected Google Drive. Keep dated backups unless the user requests retention or deletion.

**Why:** The user asked to replace Render Cron with HostGator, but the shared cPanel account lacks the required PostgreSQL client tools. Replit still owns the Drive connection and should not receive the production database URL.

**How to apply:** Use Render Cron with the existing Docker image, or upgrade HostGator to a plan where PostgreSQL client tools can be installed. Do not attempt an unreliable shared-host workaround. If HostGator becomes a viable runner, configure secrets in a private file outside `public_html`, and send only the dump, filename, and checksum through the token-protected Replit receiver.