---
name: Playwright Chromium path
description: Running Playwright browser tests in this Replit workspace
---

The workspace provides Chromium at `/repl/tools/bin/chromium`, while Playwright's pinned browser may not be downloaded. The Playwright config supports `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` as an override.

**Why:** Browser tests failed to launch because the expected Playwright browser revision was absent even though a usable system Chromium was installed.

**How to apply:** Run Playwright with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/repl/tools/bin/chromium` when the default browser executable is missing; keep the default path behavior for other environments.