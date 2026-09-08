# Build the 915motors Android APK

This folder is part of a small pnpm workspace because the mobile app uses the
shared API client in `lib/api-client-react`.

## Recommended: build an APK with EAS

Install Node.js and pnpm on your computer, then from this workspace folder run:

```bash
pnpm install
cd artifacts/915motors-mobile
npx eas-cli@latest login
npx eas-cli@latest build -p android --profile preview
```

The `preview` profile is configured to produce an installable `.apk`. EAS will
show the download URL when the build finishes.

Use the `production` profile only when you intentionally want to build with
the production Android credentials:

```bash
npx eas-cli@latest build -p android --profile production
```

## Square registration

The APK must be built with the same Android credentials registered in Square.
The Android package name is:

```text
com.motors915.mobile
```

To inspect the certificate fingerprint from the exact APK you install:

```bash
apksigner verify --print-certs your-app.apk
```

Use the SHA-256 value in Square in the format Square requests: lowercase,
without colons, and without the `SHA-256:` label.

## Important

- This builds a standalone APK; it is not the Expo Go preview.
- Do not commit or share keystores, passwords, access tokens, or `.env` files.
- The app opens the configured production web app and API at
  `https://app.915motorsusa.com`.