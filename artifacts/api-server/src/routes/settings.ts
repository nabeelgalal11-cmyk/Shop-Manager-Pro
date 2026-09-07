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

// Shop-wide labor rate used by repair-order profitability and reports.
router.get("/shop", requirePermission("permissions", "view"), async (_req, res) => {
  const row = await ensureSettingsRow();
  res.json({
    laborRate: Number(row.laborRate),
    shopName: row.shopName ?? "",
    addressLine1: row.addressLine1 ?? "",
    addressLine2: row.addressLine2 ?? "",
    city: row.city ?? "",
    state: row.state ?? "",
    postalCode: row.postalCode ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    ein: row.ein ?? "",
    website: row.website ?? "",
    additionalInfo: row.additionalInfo ?? "",
  });
});

router.put("/shop", requirePermission("permissions", "edit"), async (req, res) => {
  const laborRate = Number(req.body?.laborRate);
  if (!Number.isFinite(laborRate) || laborRate < 0 || laborRate > 10000) {
    return res.status(400).json({ error: "Labor rate must be a number between $0 and $10,000 per hour" });
  }

  const row = await ensureSettingsRow();
  const textFields = [
    "shopName", "addressLine1", "addressLine2", "city", "state",
    "postalCode", "phone", "email", "ein", "website", "additionalInfo",
  ] as const;
  const profileUpdate = Object.fromEntries(
    textFields
      .filter((field) => typeof req.body?.[field] === "string")
      .map((field) => [field, req.body[field].trim() || null]),
  );
  await db
    .update(shopSettingsTable)
    .set({ laborRate: laborRate.toFixed(2), ...profileUpdate, updatedAt: new Date() })
    .where(eq(shopSettingsTable.id, row.id));

  res.json({
    ok: true,
    laborRate,
    ...Object.fromEntries(textFields.map((field) => [
      field,
      field in profileUpdate ? profileUpdate[field] ?? "" : row[field] ?? "",
    ])),
  });
});

// Stripe settings — only admins (managed via permissions on `permissions` resource)
router.get("/payments", requirePermission("permissions", "view"), async (_req, res) => {
  const row = await ensureSettingsRow();
  res.json({
    publishableKey: row.stripePublishableKey ?? "",
    // Mask secret values; UI should show whether they are set, not the value.
    secretKeySet: !!row.stripeSecretKey,
    webhookSecretSet: !!row.stripeWebhookSecret,
    achEnabled: !!row.stripeAchEnabled,
  });
});

router.put("/payments", requirePermission("permissions", "edit"), async (req, res) => {
  const { publishableKey, secretKey, webhookSecret, achEnabled } = req.body ?? {};
  const row = await ensureSettingsRow();
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof publishableKey === "string") update.stripePublishableKey = publishableKey.trim() || null;
  // Only update secrets if provided AND non-empty (empty string means "leave alone").
  if (typeof secretKey === "string" && secretKey.trim()) update.stripeSecretKey = secretKey.trim();
  if (typeof webhookSecret === "string" && webhookSecret.trim()) update.stripeWebhookSecret = webhookSecret.trim();
  if (typeof achEnabled === "boolean") update.stripeAchEnabled = achEnabled;
  // Allow explicit clearing via {clear:true} flags
  if (req.body?.clearSecretKey) update.stripeSecretKey = null;
  if (req.body?.clearWebhookSecret) update.stripeWebhookSecret = null;
  await db.update(shopSettingsTable).set(update).where(eq(shopSettingsTable.id, row.id));
  res.json({ ok: true });
});

// ---- Twilio messaging settings ----
router.get("/messaging", requirePermission("permissions", "view"), async (_req, res) => {
  const row = await ensureSettingsRow();
  res.json({
    accountSid: row.twilioAccountSid ?? "",
    authTokenSet: !!row.twilioAuthToken,
    fromNumber: row.twilioFromNumber ?? "",
  });
});

router.put("/messaging", requirePermission("permissions", "edit"), async (req, res) => {
  const { accountSid, authToken, fromNumber } = req.body ?? {};
  const row = await ensureSettingsRow();
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof accountSid === "string") update.twilioAccountSid = accountSid.trim() || null;
  if (typeof fromNumber === "string") update.twilioFromNumber = fromNumber.trim() || null;
  if (typeof authToken === "string" && authToken.trim()) update.twilioAuthToken = authToken.trim();
  if (req.body?.clearAuthToken) update.twilioAuthToken = null;
  await db.update(shopSettingsTable).set(update).where(eq(shopSettingsTable.id, row.id));
  res.json({ ok: true });
});

export default router;
