---
name: Production host split
description: Distinguishes the custom production host from the Replit preview deployment when investigating live web-app behavior.
---

The custom host `app.915motorsusa.com` is served by Render, while the Replit deployment has a separate `*.replit.app` URL and separate runtime logs. Confirm the response headers and bundle timestamp for the exact host the user is testing before treating Replit deployment logs as production evidence.

**Why:** Both deployments can serve the same repository while running different builds and session stores, so debugging the wrong host produces misleading 401s and stale-bundle conclusions.

**How to apply:** When the user reports a live web/mobile WebView issue, check the tested hostname's server headers, HTML asset hash, and deployment status first; only use Replit deployment diagnostics for the Replit-hosted URL.