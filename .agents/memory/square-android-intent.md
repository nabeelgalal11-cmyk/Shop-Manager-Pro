---
name: Square Android intent handoff
description: Correct launch mechanism for Square Point of Sale from the Expo mobile app
---

The Android Square Point of Sale request must be launched as an explicit native Android intent with action `com.squareup.pos.action.CHARGE`, package `com.squareup`, API `v2.1`, and the documented `com.squareup.pos.*` extras. Native `TENDER_TYPES` is an array of fully qualified tender extra names, not a comma-separated string. Native completion returns transaction IDs in result extras; it does not use the web callback URI.

**Why:** Linking.openURL treats the `intent:` value as a normal `ACTION_VIEW` URI, so Android cannot resolve the embedded action and reports that no activity handles it even when Square is installed.

**How to apply:** Use Expo's native intent launcher for Android, include amount in cents, client, API version, SDK version, currency, location, note, request metadata, and the tender-type array; verify the returned server transaction ID with Square before applying the invoice payment. Register the exact APK package and SHA-1 signing fingerprint in Square's Android Point of Sale API settings. Keep the web callback path only for web/iOS flows that use it.

The tested APK works after registering its exact `com.motors915.mobile` package and SHA-1 certificate fingerprint in Square. A new signing credential requires updating that Square registration before payment handoff can work.

**Why:** Square validates the Android caller before opening the payment flow; a package or certificate mismatch produces an immediate “app package name is unknown” error even when the intent payload is valid.

**How to apply:** When building with a different EAS credential, inspect that APK's SHA-1 fingerprint and update Square's Android registration before distributing it.