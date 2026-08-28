---
name: PartsTech API access
description: Credential and access requirements for PartsTech catalog pricing and availability.
---

Direct PartsTech catalog search and quote access requires two credential pairs: the shop user's username/API key and a separate partner ID/API key issued to the integrating shop-management system.

**Why:** PartsTech's official OpenAPI contract requires both identities for user access tokens, and a live read-only authentication attempt with only the shop identity was rejected as an invalid request.

**How to apply:** Do not build against guessed endpoints or treat the shop API key as sufficient. Obtain partner API access from PartsTech before implementing supplier pricing and availability; keep all four values server-side in workspace secrets.