---
name: Render pnpm pin
description: Render startup failures caused by Corepack selecting an unavailable pnpm release
---

The workspace must declare an explicit `packageManager` version compatible with the committed pnpm lockfile. Render previously selected pnpm 12.3.4 by default and failed before starting the API because Corepack could not find its cached `pnpm.cjs`; pnpm 10.26.1 resolves successfully in this project.

**Why:** Render invokes `pnpm` for the service start command, so a provider-side default package-manager change can crash the service before application code runs.

**How to apply:** Keep the root package manager pin synchronized with the lockfile and verify `corepack pnpm --version` plus the API production build before publishing.