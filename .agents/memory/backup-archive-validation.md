---
name: Custom archive validation
description: Full validation requirements for PostgreSQL custom-format backup archives before destructive restore.
---

For custom-format PostgreSQL backups, a successful `pg_restore --list` only proves the table of contents can be read; truncated or damaged compressed data later in the archive can still pass. Before applying objects, run a full read/decompression pass with `pg_restore --file=/dev/null --exit-on-error`.

**Why:** A PostgreSQL 16 check showed a truncated data payload could pass `--list` but fail during the full read. Discovering that only during restore risks leaving the target partially changed.

**How to apply:** Keep full archive validation ahead of any restore invocation that connects to the database. Preserve a regression test that confirms corrupt/truncated input stops before the apply command.