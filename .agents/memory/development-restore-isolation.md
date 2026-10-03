---
name: Development restore isolation
description: Safety requirements for manual database restores used to test PostgreSQL backup archives.
---

Manual restore must target a dedicated connection reserved for restore testing, not the application's primary `DATABASE_URL`. Require an exact host/database allowlist, block Render hosts and production runtime, and display only the host and database name. A Neon hostname alone does not reveal whether the branch is production; verify the branch in Neon before restoring.

The current allowlisted Neon project is test-only and was created under a separate email, as confirmed by the user. Its only branch is named `production` and marked default/primary; the branch label alone does not indicate that this project contains live data.

**Why:** `pg_restore --clean` is destructive, and a development process can still be configured with a production-capable PostgreSQL URL. Provider hostnames alone do not establish that a Neon branch is disposable, and branch names can be misleading.

**How to apply:** Keep the restore endpoint disabled until the dedicated restore connection and exact target allowlist are configured. Verify branch identity in Neon and obtain explicit confirmation when metadata is ambiguous. If the target changes, verify it again. Never use production database credentials in the development restore connection.