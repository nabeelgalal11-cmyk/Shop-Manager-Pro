---
name: Square phone-reader payments
description: The integration choice for accepting invoice payments with a reader paired to the official Square POS phone app.
---

Use Square's Point of Sale app-switch API for the existing phone-paired reader. The companion app sends a signed invoice payment request to the official Square POS app, then returns through a registered callback and verifies the payment server-side before crediting the invoice.

**Why:** This uses the shop's existing reader and official Square POS app without requiring a separate native reader SDK integration. A returned identifier alone is not trustworthy enough to alter invoice accounting.

**How to apply:** Keep invoice amount, user, location, expiry, and request nonce in tamper-resistant state; retrieve and validate the Square payment before invoking idempotent reconciliation. Do not credit unverifiable legacy transaction IDs.