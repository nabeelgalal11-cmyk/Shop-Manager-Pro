---
name: Direct Gemini model availability
description: Direct Google Gemini API model availability and fallback behavior for new accounts
---

For direct Google Gemini API keys, do not assume a previously documented Flash model is available. Query the account’s `models` endpoint and choose a listed model that supports `generateContent`; the `gemini-flash-lite-latest` alias produced structured JSON reliably for the estimate use case.

**Why:** Google may return 404 for older Flash model names on new accounts, while newer Flash models can temporarily return 503 high-demand errors.

**How to apply:** When the Gemini provider changes or a new account is configured, verify the live model list and keep structured output schema validation plus short retries for transient 429/503 responses.