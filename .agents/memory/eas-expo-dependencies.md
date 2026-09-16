---
name: EAS Expo dependencies
description: Dependency classification needed for standalone Expo cloud builds in this workspace
---

Standalone Expo cloud builds may omit devDependencies before evaluating app plugins. Expo, expo-router, React Native, and packages imported by the mobile app must therefore be available from dependencies.

**Why:** The cloud build could install the project but fail while resolving the expo-router config plugin because the Expo stack was classified as development-only, even though local pnpm execution succeeded.

**How to apply:** Keep the mobile package's runtime Expo/native stack in dependencies and validate with a frozen-lockfile install before retrying a cloud build.