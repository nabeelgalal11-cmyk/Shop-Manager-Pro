import { Router } from "express";
import { db, shopSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requirePermission } from "../lib/auth.js";

const router: Router = Router();

async function ensureSettingsRow() {
  const [existing] = await db.select().from(shopSettingsTable).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(shopSettingsTable).values({}).returning();
  return created;
}

// Stripe settings — only admins (managed via permissions on `permissions` resource)
router.get("/payments", requirePermission("permissions", "view"), async (_req, res) => {
  const row = await ensureSettingsRow();
  res.json({
    publishableKey: row.stripePublishableKey ?? "",
    // Mask secret values; UI should show whether they are set, not the value.
    secretKeySet: !!row.stripeSecretKey,
    webhookSecretSet: !!row.stripeWebhookSecret,
  });
});

router.put("/payments", requirePermission("permissions", "edit"), async (req, res) => {
  const { publishableKey, secretKey, webhookSecret } = req.body ?? {};
  const row = await ensureSettingsRow();
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof publishableKey === "string") update.stripePublishableKey = publishableKey.trim() || null;
  // Only update secrets if provided AND non-empty (empty string means "leave alone").
  if (typeof secretKey === "string" && secretKey.trim()) update.stripeSecretKey = secretKey.trim();
  if (typeof webhookSecret === "string" && webhookSecret.trim()) update.stripeWebhookSecret = webhookSecret.trim();
  // Allow explicit clearing via {clear:true} flags
  if (req.body?.clearSecretKey) update.stripeSecretKey = null;
  if (req.body?.clearWebhookSecret) update.stripeWebhookSecret = null;
  await db.update(shopSettingsTable).set(update).where(eq(shopSettingsTable.id, row.id));
  res.json({ ok: true });
});

export default router;
