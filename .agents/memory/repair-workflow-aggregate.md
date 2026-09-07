---
name: Repair workflow aggregate
description: Durable lifecycle, history, accounting, and authorization rules for the repair domain.
---

Treat the Repair Order as the aggregate root for the complete visit. Estimates and supplements are immutable revisions; item-level approval snapshots authorize distinct work items. Only performed authorized work can become immutable invoice items, and each Repair Order has at most one final invoice.

**Why:** Mutable estimate decisions, duplicated labor/parts fields, polymorphic line items, and invoice-to-estimate coupling could lose approval evidence and let workflow or financial records diverge.

**How to apply:** Add lifecycle behavior through explicit transactional actions with row locking, object-level authorization, idempotency, append-only events, and PostgreSQL transition guards. Use integer cents and tax basis points. Never delete final payment history; represent refunds and voids as verified reversal ledger rows, and do not reopen an invoice before processor success is confirmed.