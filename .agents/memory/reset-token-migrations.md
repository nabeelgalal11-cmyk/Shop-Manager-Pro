---
name: Reset-token migrations
description: Database alignment needed for password recovery token storage
---

Password recovery can return its intentionally generic success response even when the token table is missing, because delivery/query errors are handled without exposing account state.

**Why:** The API may connect to a different Postgres endpoint than a shell migration command, so a migration can appear successful while the running app still lacks the table.

**How to apply:** For password recovery schema changes, verify the table exists in the same `DATABASE_URL` used by the API before testing the email flow.