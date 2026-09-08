---
name: EAS standalone bundles
description: Constraint for building the mobile app from a downloadable source bundle with Expo Application Services
---

When a mobile app is delivered as a standalone source bundle, EAS installs dependencies from the uploaded app directory. Dependencies using parent-workspace-only specifiers such as `workspace:*` or `catalog:` are not portable unless the full monorepo is included and the build context is configured accordingly. Use a local bundled client package and concrete dependency versions for downloadable APK sources.

**Why:** Local installs can succeed from the monorepo while EAS fails during its remote Install dependencies phase because the parent workspace metadata is not part of the app upload context.

**How to apply:** Before delivering a mobile APK source archive, install dependencies and run an Expo Android export from the standalone app root; verify that the Android application ID and production API URL resolve from the bundled app config.