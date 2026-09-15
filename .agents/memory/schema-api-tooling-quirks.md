---
name: Schema and API tooling quirks
description: Environment-specific constraints encountered when publishing database schema changes and regenerating the OpenAPI client.
---

When adding a narrow database change, prefer an explicit additive SQL migration against `DATABASE_URL` if Drizzle push stops on an unrelated destructive prompt. Do not force truncation of existing master data just to apply an additive column.

When regenerating the OpenAPI clients, verify that the current Orval setup can resolve the local YAML input before relying on it; in this workspace the installed Orval version can fail even with an absolute target and clean the generated directories, so preserve the checked-in clients and make only narrow contract additions when needed.

**Why:** The workspace database contained existing customer data that triggered an unrelated unique-constraint prompt, while the installed Orval version failed before parsing the local OpenAPI file and cleaned generated output.

**How to apply:** Use additive migrations for isolated schema changes, and run client generation only after confirming its input resolver works in the current dependency environment.