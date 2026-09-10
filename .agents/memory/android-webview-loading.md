---
name: Android WebView loading
description: Reliable completion and failure handling for the mobile app's embedded production website.
---

Do not use `onLoadEnd` as the only signal for removing a native loading overlay around an Android WebView. Also respond to meaningful load progress and navigation completion, and enforce a short fallback timeout so rendered content cannot remain hidden forever. Surface HTTP and renderer failures explicitly.

**Why:** An installed Android build displayed the production website behind a permanent native “Loading 915motors…” overlay because that device's System WebView did not emit the expected completion callback. The multi-signal fallback was confirmed to resolve the issue in the rebuilt APK.

**How to apply:** Any future change to the embedded web-app screen must preserve multiple completion signals, a bounded loading overlay, and visible failure states. Native wrapper fixes require rebuilding the APK; a Render web deployment cannot update installed native code.