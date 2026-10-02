---
name: Production host split
description: Distinguishes Render app deploys from Replit publishing and the live database.
---

The custom host `app.915motorsusa.com` is served by Render, while the Replit deployment has a separate `*.replit.app` URL and separate runtime logs. Confirm the response headers and bundle timestamp for the exact host the user is testing before treating Replit deployment logs as production evidence.

Git pushes to the deployed branch trigger Render automatically. Replit Publish is a separate operation and can apply schema changes to the live database; it is not just a web-app publish.

**Why:** Both deployments can serve the same repository while running different builds and session stores, so debugging the wrong host produces misleading 401s and stale-bundle conclusions. A push or Replit Publish can affect production in different ways.

**How to apply:** Before recommending or performing either operation, identify the exact code commits and database changes it will release. Treat a push as a Render production deploy, and review the live schema diff and verified backup before Replit Publish.