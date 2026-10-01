---
name: Development restore isolation
description: Safety requirements for manual database restores used to test PostgreSQL backup archives.
---

Manual restore must target a dedicated connection reserved for restore testing, not the application's primary `DATABASE_URL`. Require an exact host/database allowlist, block Render hosts and production runtime, and display only the host and database name. A Neon hostname alone does not reveal whether the branch is production; verify the branch in Neon before restoring.

**Why:** `pg_restore --clean` is destructive, and a development process can still be configured with a production-capable PostgreSQL URL. Provider hostnames alone do not establish that a Neon branch is disposable.

**How to apply:** Keep the restore endpoint disabled until the dedicated restore connection and exact target allowlist are configured. Never use production database credentials in the development restore connection.