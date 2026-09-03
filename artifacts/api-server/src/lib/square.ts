import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const SQUARE_API_VERSION = "2026-01-22";
const SANDBOX_URL = "https://connect.squareupsandbox.com/v2";
const PRODUCTION_URL = "https://connect.squareup.com/v2";

export class SquareError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "SquareError";
  }
}

export function dollarsToCents(value: number | string): number {
  const cents = Math.round(Number(value) * 100);
  if (!Number.isFinite(cents) || cents < 0) throw new SquareError("Amount must be a non-negative monetary value", 400);
  return cents;
}
export function centsToDollars(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new SquareError("Amount in cents must be an integer", 400);
  return (cents / 100).toFixed(2);
}
export const squareIdempotencyKey = (): string => randomUUID();

type SquareResponse<T> = T & { errors?: Array<{ code?: string; detail?: string; category?: string }> };

export class SquareClient {
  readonly baseUrl: string;
  constructor(private readonly accessToken = process.env.SQUARE_ACCESS_TOKEN, environment = process.env.SQUARE_ENVIRONMENT ?? "sandbox") {
    if (!accessToken) throw new SquareError("Square access token is not configured", 503, "SQUARE_NOT_CONFIGURED");
    if (environment !== "sandbox" && environment !== "production") throw new SquareError("SQUARE_ENVIRONMENT must be sandbox or production", 500);
    this.baseUrl = environment === "production" ? PRODUCTION_URL : SANDBOX_URL;
  }
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.accessToken}`, "Square-Version": SQUARE_API_VERSION, "Content-Type": "application/json", ...init.headers },
    });
    const body = await response.json().catch(() => ({})) as SquareResponse<T>;
    if (!response.ok || body.errors?.length) {
      const first = body.errors?.[0];
      throw new SquareError(first?.detail ?? "Square request failed", response.status, first?.code, body.errors);
    }
    return body as T;
  }
  locations() { return this.request<{ locations: any[] }>("/locations"); }
  getPayment(id: string) { return this.request<{ payment: any }>(`/payments/${encodeURIComponent(id)}`); }
  createPayment(input: { sourceId: string; amountCents: number; locationId: string; customerId?: string; referenceId?: string; note?: string; idempotencyKey?: string }) {
    return this.request<{ payment: any }>("/payments", { method: "POST", body: JSON.stringify({ idempotency_key: input.idempotencyKey ?? squareIdempotencyKey(), source_id: input.sourceId, amount_money: { amount: input.amountCents, currency: "USD" }, location_id: input.locationId, customer_id: input.customerId, reference_id: input.referenceId, note: input.note }) });
  }
  createTerminalCheckout(input: { deviceId: string; amountCents: number; referenceId: string; note?: string; idempotencyKey?: string }) {
    return this.request<{ checkout: any }>("/terminals/checkouts", { method: "POST", body: JSON.stringify({ idempotency_key: input.idempotencyKey ?? squareIdempotencyKey(), checkout: { device_options: { device_id: input.deviceId }, amount_money: { amount: input.amountCents, currency: "USD" }, reference_id: input.referenceId, note: input.note } }) });
  }
  getTerminalCheckout(id: string) { return this.request<{ checkout: any }>(`/terminals/checkouts/${encodeURIComponent(id)}`); }
  cancelTerminalCheckout(id: string) { return this.request<{ checkout: any }>(`/terminals/checkouts/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" }); }
  createRefund(input: { paymentId: string; amountCents: number; reason?: string; idempotencyKey?: string }) {
    return this.request<{ refund: any }>("/refunds", { method: "POST", body: JSON.stringify({ idempotency_key: input.idempotencyKey ?? squareIdempotencyKey(), payment_id: input.paymentId, amount_money: { amount: input.amountCents, currency: "USD" }, reason: input.reason }) });
  }
  listCustomers(cursor?: string) { return this.request<{ customers?: any[]; cursor?: string }>(`/customers${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`); }
  searchCatalog(cursor?: string) {
    const query = new URLSearchParams({ types: "ITEM" });
    if (cursor) query.set("cursor", cursor);
    return this.request<{ objects?: any[]; cursor?: string }>(`/catalog/list?${query}`);
  }
  batchRetrieveInventoryCounts(catalogObjectIds: string[], locationIds: string[]) {
    return this.request<{ counts?: any[] }>("/inventory/batch-retrieve-counts", { method: "POST", body: JSON.stringify({ catalog_object_ids: catalogObjectIds, location_ids: locationIds }) });
  }
}

/** Square signs `notificationUrl + exactRawBody` with HMAC-SHA256/base64. */
export function verifySquareWebhookSignature(rawBody: Buffer, signature: string | undefined, notificationUrl: string, signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY): boolean {
  if (!signatureKey) throw new SquareError("Square webhook signing key is not configured", 503, "SQUARE_WEBHOOK_NOT_CONFIGURED");
  if (!signature || !notificationUrl) return false;
  const expected = createHmac("sha256", signatureKey).update(notificationUrl).update(rawBody).digest("base64");
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}