---
name: Production host split
description: Distinguishes Render app deploys from Replit publishing and the live database.
---

The custom host `app.915motorsusa.com` is served by Render, while the Replit deployment has a separate `*.replit.app` URL and separate runtime logs. Confirm the response headers and bundle timestamp for the exact host the user is testing before treating Replit deployment logs as production evidence.

Git pushes to the deployed branch trigger Render automatically. Replit Publish is a separate operation that applies development schema changes to the production database; the user confirms that, for this project, it affects the live Neon database. This is distinct from the separate test-only Neon project used for restore verification.

**Why:** Both deployments can serve the same repository while running different builds and session stores, and the separate test-only Neon project is easy to confuse with the live Neon database. Treating Replit Publish as unrelated to live data could skip a needed schema update or cause an unsafe one.

**How to apply:** Distinguish a Render code deploy from Replit's production schema sync. Before recommending Publish, verify that its schema diff targets the live Neon database and review the diff and verified backup; never assume the restore-test Neon project is production.