---
name: Square Android intent handoff
description: Correct launch mechanism for Square Point of Sale from the Expo mobile app
---

The Android Square Point of Sale request must be launched as an explicit native Android intent with action `com.squareup.pos.action.CHARGE`, package `com.squareup`, and the documented `com.squareup.pos.*` extras. The browser-form `intent:#Intent...end` URI must not be sent through React Native Linking.

**Why:** Linking.openURL treats the `intent:` value as a normal `ACTION_VIEW` URI, so Android cannot resolve the embedded action and reports that no activity handles it even when Square is installed.

**How to apply:** Use Expo's native intent launcher for Android, include `WEB_CALLBACK_URI`, amount, client, API version, location, note, request metadata, and required tender types; keep the custom callback listener for the return flow.