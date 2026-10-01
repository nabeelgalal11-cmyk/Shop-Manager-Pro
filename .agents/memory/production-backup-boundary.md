---
name: Production backup boundary
description: Preserve host separation for production PostgreSQL dumps and Google Drive uploads.
---

The user prefers HostGator to run daily production database backups instead of Render Cron. The current HostGator plan is Linux Shared cPanel. HostGator documents PostgreSQL service as unavailable on Shared hosting; this does not establish whether a compatible `pg_dump` client is installed. Before switching, verify `pg_dump`/`pg_restore` version 16 or later, `curl`, `sha256sum`, cron access, and outbound access to Render's external PostgreSQL endpoint. Store the production database URL only on HostGator, never in Replit. The Replit deployment remains an authenticated relay that uploads verified dump bytes to connected Google Drive. Keep dated backups unless the user requests retention or deletion.

**Why:** The user asked to replace Render Cron with HostGator, but shared-host PostgreSQL tooling and runtime limits are not yet verified. Replit still owns the Drive connection and should not receive the production database URL.

**How to apply:** First verify HostGator command-line prerequisites in cPanel Terminal. If available, configure the cron job with a private config file outside `public_html`, and send only the dump, filename, and checksum through the token-protected Replit receiver. If the shared plan lacks the required client or runtime access, use Render Cron or upgrade HostGator rather than attempting an unreliable shared-host workaround.