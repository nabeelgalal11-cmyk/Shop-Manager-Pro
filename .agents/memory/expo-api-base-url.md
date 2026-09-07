---
name: Expo release API base URL
description: Native release bundles may not receive Replit EXPO_PUBLIC_DOMAIN at build time.
---

The mobile app must keep a non-secret production API base URL in Expo static configuration as a fallback, while allowing `EXPO_PUBLIC_API_URL` or `EXPO_PUBLIC_DOMAIN` to override it for development and previews.

**Why:** Android native bundles do not have browser-relative URL resolution and a missing build-time domain turns `/api/...` requests into invalid URLs.

**How to apply:** When changing mobile networking or release configuration, export the Android bundle with the environment variables empty and verify it still has an absolute API origin before distributing an APK.