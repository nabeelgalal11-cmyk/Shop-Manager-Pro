---
name: Windows APK bundles
description: Packaging constraints for handing the mobile workspace to Windows build environments
---

Windows build bundles must include the workspace-root ignore rules and exclude node_modules, Expo dist output, and static-build output. The root ignore file must cover dependencies in the workspace root, not only the mobile package.

**Why:** Windows Git path limits can fail a build when pnpm's deeply nested React Native files are indexed, even though the application source and dependency installation are valid.

**How to apply:** Build source ZIPs from clean source trees, keep generated output out of the archive, and include the root .gitignore before handing the bundle to a Windows build process.