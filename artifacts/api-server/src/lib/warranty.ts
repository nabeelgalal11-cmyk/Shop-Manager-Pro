import { db } from "@workspace/db";
import { inventoryTable, invoiceItemsTable, repairOrderWorkItemsTable, estimateItemsTable, repairOrdersTable, invoicesTable, vehiclesTable } from "@workspace/db";
import { eq, inArray, and } from "drizzle-orm";

type WarrantyFields = { warrantyMonths?: number | null; warrantyMiles?: number | null };

type WarrantyInput = {
  warrantyMonths?: number | string | null;
  warrantyMiles?: number | string | null;
};

function toWarrantyNumber(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickWarranty(input: WarrantyInput): WarrantyFields {
  return {
    warrantyMonths: toWarrantyNumber(input?.warrantyMonths),
    warrantyMiles: toWarrantyNumber(input?.warrantyMiles),
  };
}

/** Pull defaultWarrantyMonths/Miles from inventory for the given ids. */
async function fetchInventoryDefaults(ids: number[]): Promise<Map<number, WarrantyFields>> {
  const out = new Map<number, WarrantyFields>();
  const unique = [...new Set(ids.filter((n) => Number.isFinite(n) && n > 0))];
  if (unique.length === 0) return out;
  const rows = await db
    .select({
      id: inventoryTable.id,
      m: inventoryTable.defaultWarrantyMonths,
      mi: inventoryTable.defaultWarrantyMiles,
    })
    .from(inventoryTable)
    .where(inArray(inventoryTable.id, unique));
  for (const r of rows) out.set(r.id, { warrantyMonths: r.m ?? null, warrantyMiles: r.mi ?? null });
  return out;
}

/**
 * Returns the items array with `warrantyMonths`/`warrantyMiles` filled
 * from inventory defaults whenever the caller didn't supply them.
 * Caller-provided values always win. Items without an inventory link
 * are passed through unchanged.
 */
export async function fillLineItemWarranties<T extends { inventoryItemId?: number | null } & WarrantyInput>(items: T[]): Promise<T[]> {
  if (!items?.length) return items ?? [];
  const ids = items.map((it) => Number(it.inventoryItemId)).filter((n): n is number => Number.isFinite(n) && n > 0);
  const defaults = await fetchInventoryDefaults(ids);
  return items.map((it) => {
    const w = pickWarranty(it);
    const id = Number(it.inventoryItemId);
    const def = Number.isFinite(id) ? defaults.get(id) : undefined;
    return {
      ...it,
      warrantyMonths: w.warrantyMonths ?? def?.warrantyMonths ?? null,
      warrantyMiles: w.warrantyMiles ?? def?.warrantyMiles ?? null,
    };
  });
}

export type VehicleWarrantyEntry = {
  source: "repair_order" | "invoice";
  sourceId: number;
  sourceNumber: string | null;
  itemType: "part" | "labor";
  description: string;
  partNumber: string | null;
  warrantyMonths: number | null;
  warrantyMiles: number | null;
  startDate: string;          // ISO
  startMileage: number | null;
  expiresOn: string | null;   // ISO date
  expiresAtMileage: number | null;
  active: boolean;
};

/**
 * Returns active warranties for a vehicle from immutable invoice items and
 * their authorized estimate-item source. A warranty is "active" when its time window
 * (startDate + warrantyMonths) is in the future AND its mileage window
 * (startMileage + warrantyMiles) hasn't been exceeded by the vehicle's
 * current mileage.
 */
export async function findActiveWarrantiesForVehicle(vehicleId: number): Promise<VehicleWarrantyEntry[]> {
  const [vehicle] = await db.select({ id: vehiclesTable.id, mileage: vehiclesTable.mileage }).from(vehiclesTable).where(eq(vehiclesTable.id, vehicleId));
  if (!vehicle) return [];

  const currentMileage = vehicle.mileage ?? null;
  const now = new Date();

  // Only issued or settled invoices represent completed billable work.
  const ACTIVE_INVOICE_STATUSES = ["issued", "partially_paid", "paid"] as const;
  const invItems = await db
    .select({
      kind: invoiceItemsTable.kind,
      description: invoiceItemsTable.description,
      warrantyMonths: estimateItemsTable.warrantyMonths,
      warrantyMiles: estimateItemsTable.warrantyMiles,
      invoiceId: invoiceItemsTable.invoiceId,
      invoiceNumber: invoicesTable.invoiceNumber,
      invoiceCreatedAt: invoicesTable.createdAt,
      invoiceIssuedAt: invoicesTable.issuedAt,
      roCompletedAt: repairOrdersTable.completedAt,
      roMileageOut: repairOrdersTable.mileageOut,
      roMileageIn: repairOrdersTable.mileageIn,
    })
    .from(invoiceItemsTable)
    .innerJoin(invoicesTable, eq(invoicesTable.id, invoiceItemsTable.invoiceId))
    .innerJoin(repairOrdersTable, eq(repairOrdersTable.id, invoicesTable.repairOrderId))
    .innerJoin(repairOrderWorkItemsTable, eq(repairOrderWorkItemsTable.id, invoiceItemsTable.sourceWorkItemId))
    .innerJoin(estimateItemsTable, eq(estimateItemsTable.id, repairOrderWorkItemsTable.sourceEstimateItemId))
    .where(and(
      eq(repairOrdersTable.vehicleId, vehicleId),
      inArray(invoicesTable.status, [...ACTIVE_INVOICE_STATUSES]),
    ));

  const out: VehicleWarrantyEntry[] = [];

  for (const li of invItems) {
    if (li.warrantyMonths == null && li.warrantyMiles == null) continue;
    const start = li.roCompletedAt ?? li.invoiceIssuedAt ?? li.invoiceCreatedAt;
    if (!start) continue;
    const expires = li.warrantyMonths != null ? new Date(new Date(start).setMonth(start.getMonth() + li.warrantyMonths)) : null;
    const startMileage = li.roMileageOut ?? li.roMileageIn ?? null;
    const expiresAtMileage = li.warrantyMiles != null && startMileage != null ? startMileage + li.warrantyMiles : null;
    const timeOk = expires == null || expires.getTime() > now.getTime();
    const milesOk = expiresAtMileage == null || currentMileage == null || currentMileage <= expiresAtMileage;
    if (!timeOk || !milesOk) continue;
    out.push({
      source: "invoice",
      sourceId: li.invoiceId!,
      sourceNumber: li.invoiceNumber ?? null,
      itemType: li.kind === "labor" ? "labor" : "part",
      description: li.description,
      partNumber: null,
      warrantyMonths: li.warrantyMonths,
      warrantyMiles: li.warrantyMiles,
      startDate: start.toISOString(),
      startMileage,
      expiresOn: expires ? expires.toISOString() : null,
      expiresAtMileage,
      active: true,
    });
  }

  return out.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
}
