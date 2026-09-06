---
name: Auth transition handling
description: Durable navigation rules for cookie-session login and password-reset flows
---

After a successful cookie-session login, rehydrate the application with a full browser navigation instead of rendering the authenticated tree only from the login response. Password-reset return actions should clear any existing session before navigating to sign-in.

**Why:** The application can otherwise enter a partially transitioned authenticated state or reopen an existing session when the user expects the login screen, which presents as a blank page when the authenticated tree fails during startup.

**How to apply:** Use this rule for web login, logout, password reset, and other flows that change the server-side session. Keep a visible error boundary around the app so render failures cannot degrade into a blank screen.