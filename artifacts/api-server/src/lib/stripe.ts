import Stripe from "stripe";
import { db, shopSettingsTable } from "@workspace/db";

export interface StripeSettings {
  publishableKey: string | null;
  secretKey: string | null;
  webhookSecret: string | null;
  achEnabled: boolean;
}

export async function getStripeSettings(): Promise<StripeSettings> {
  const [row] = await db.select().from(shopSettingsTable).limit(1);
  return {
    publishableKey: row?.stripePublishableKey ?? null,
    secretKey: row?.stripeSecretKey ?? null,
    webhookSecret: row?.stripeWebhookSecret ?? null,
    achEnabled: row?.stripeAchEnabled ?? false,
  };
}

export async function getStripeClient(): Promise<Stripe> {
  const { secretKey } = await getStripeSettings();
  if (!secretKey) {
    throw new Error("Stripe is not configured. Add a secret key in Settings → Payments.");
  }
  // Don't pin apiVersion; let the SDK use its bundled default. This avoids
  // having to widen the typed enum when Stripe ships a new version.
  return new Stripe(secretKey);
}
