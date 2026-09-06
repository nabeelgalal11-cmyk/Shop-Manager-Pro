---
name: React Query monorepo resolution
description: Shared generated clients can resolve a separate React Query context from the app provider.
---

In the ShopOS Vite app, dedupe `@tanstack/react-query` alongside React and React DOM when workspace packages import generated React Query hooks.

**Why:** The app and the symlinked shared API client can resolve identical React Query versions through different React peer paths; hooks from one copy cannot see a provider from the other and throw `No QueryClient set`.

**How to apply:** When adding or changing workspace packages that import React Query, preserve the Vite resolver dedupe and verify an authenticated startup path, not only the public login page.