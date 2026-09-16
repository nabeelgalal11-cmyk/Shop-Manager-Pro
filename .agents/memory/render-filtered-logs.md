---
name: Render filtered logs
description: How to interpret Render log exports that contain only structured level-30 entries
---

Render log exports named or filtered as `level-30` may omit plain `console.log` startup lines, so the absence of a boot diagnostic does not prove that an older deployment is running.

**Why:** Square production debugging produced a 503 in the structured request log while the startup configuration line was absent from a level-filtered attachment.

**How to apply:** Prefer structured `logger.warn`/`logger.info` diagnostics for deploy-time configuration checks. Log only presence flags, environment names, status codes, and safe error codes; never log credential values.