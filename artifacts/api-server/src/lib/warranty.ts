import { db } from "@workspace/db";
import { inventoryTable, lineItemsTable, repairOrdersTable, invoicesTable, vehiclesTable } from "@workspace/db";
import { eq, inArray, and, isNotNull, desc } from "drizzle-orm";

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

/** Same but for RO `parts` jsonb entries (which use `inventoryId` not `inventoryItemId`). */
export async function fillRoPartsWarranties<T extends { inventoryId?: number | null } & WarrantyInput>(parts: T[]): Promise<T[]> {
  if (!parts?.length) return parts ?? [];
  const ids = parts.map((p) => Number(p.inventoryId)).filter((n): n is number => Number.isFinite(n) && n > 0);
  const defaults = await fetchInventoryDefaults(ids);
  return parts.map((p) => {
    const w = pickWarranty(p);
    const id = Number(p.inventoryId);
    const def = Number.isFinite(id) ? defaults.get(id) : undefined;
    return {
      ...p,
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
 * Returns active warranties for a vehicle by joining completed repair-order
 * line items, completed-RO `parts` jsonb entries, and paid/sent invoice line
 * items linked to the vehicle. A warranty is "active" when its time window
 * (startDate + warrantyMonths) is in the future AND its mileage window
 * (startMileage + warrantyMiles) hasn't been exceeded by the vehicle's
 * current mileage.
 */
export async function findActiveWarrantiesForVehicle(vehicleId: number): Promise<VehicleWarrantyEntry[]> {
  const [vehicle] = await db.select({ id: vehiclesTable.id, mileage: vehiclesTable.mileage }).from(vehiclesTable).where(eq(vehiclesTable.id, vehicleId));
  if (!vehicle) return [];

  const currentMileage = vehicle.mileage ?? null;
  const now = new Date();

  // 1) Line items from finalized invoices linked to this vehicle. Only
  //    sent/paid/overdue invoices represent real billed work; draft and
  //    void invoices are ignored. Source start mileage from the linked
  //    RO's mileageOut/mileageIn when available so mileage expiry works.
  const ACTIVE_INVOICE_STATUSES = ["sent", "paid", "overdue"] as const;
  const invItems = await db
    .select({
      id: lineItemsTable.id,
      type: lineItemsTable.type,
      description: lineItemsTable.description,
      partNumber: lineItemsTable.partNumber,
      warrantyMonths: lineItemsTable.warrantyMonths,
      warrantyMiles: lineItemsTable.warrantyMiles,
      invoiceId: lineItemsTable.invoiceId,
      invoiceNumber: invoicesTable.invoiceNumber,
      invoiceVehicleId: invoicesTable.vehicleId,
      invoiceCreatedAt: invoicesTable.createdAt,
      roCompletedAt: repairOrdersTable.completedAt,
      roMileageOut: repairOrdersTable.mileageOut,
      roMileageIn: repairOrdersTable.mileageIn,
    })
    .from(lineItemsTable)
    .leftJoin(invoicesTable, eq(invoicesTable.id, lineItemsTable.invoiceId))
    .leftJoin(repairOrdersTable, eq(repairOrdersTable.id, invoicesTable.repairOrderId))
    .where(and(
      eq(invoicesTable.vehicleId, vehicleId),
      isNotNull(lineItemsTable.invoiceId),
      inArray(invoicesTable.status, [...ACTIVE_INVOICE_STATUSES]),
    ));

  // 2) RO parts jsonb on completed orders for this vehicle. RO labor isn't
  //    itemized at the RO level (only as `laborHours`); labor warranties
  //    surface via the related invoice line items above.
  const completedROs = await db
    .select({
      id: repairOrdersTable.id,
      orderNumber: repairOrdersTable.orderNumber,
      parts: repairOrdersTable.parts,
      completedAt: repairOrdersTable.completedAt,
      mileageOut: repairOrdersTable.mileageOut,
      mileageIn: repairOrdersTable.mileageIn,
    })
    .from(repairOrdersTable)
    .where(and(
      eq(repairOrdersTable.vehicleId, vehicleId),
      eq(repairOrdersTable.status, "completed"),
    ))
    .orderBy(desc(repairOrdersTable.completedAt));

  const out: VehicleWarrantyEntry[] = [];

  for (const li of invItems) {
    if (li.warrantyMonths == null && li.warrantyMiles == null) continue;
    if (li.invoiceVehicleId !== vehicleId) continue;
    // Prefer the linked RO's completion date — that's the actual "work
    // completed" moment a customer's warranty period runs from. Fall back
    // to the invoice creation date only when no RO link exists.
    const start = li.roCompletedAt ?? li.invoiceCreatedAt ?? null;
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
      itemType: li.type === "labor" ? "labor" : "part",
      description: li.description,
      partNumber: li.partNumber ?? null,
      warrantyMonths: li.warrantyMonths,
      warrantyMiles: li.warrantyMiles,
      startDate: start.toISOString(),
      startMileage,
      expiresOn: expires ? expires.toISOString() : null,
      expiresAtMileage,
      active: true,
    });
  }

  type RoPartJson = {
    name?: string;
    partNumber?: string | null;
    warrantyMonths?: number | null;
    warrantyMiles?: number | null;
  };

  for (const ro of completedROs) {
    const start = ro.completedAt ?? null;
    if (!start) continue;
    const startMileage = ro.mileageOut ?? ro.mileageIn ?? null;
    const partsArr: RoPartJson[] = Array.isArray(ro.parts) ? (ro.parts as RoPartJson[]) : [];
    for (const p of partsArr) {
      const wm = p?.warrantyMonths ?? null;
      const wmi = p?.warrantyMiles ?? null;
      if (wm == null && wmi == null) continue;
      const expires = wm != null ? new Date(new Date(start).setMonth(start.getMonth() + wm)) : null;
      const expiresAtMileage = wmi != null && startMileage != null ? startMileage + wmi : null;
      const timeOk = expires == null || expires.getTime() > now.getTime();
      const milesOk = expiresAtMileage == null || currentMileage == null || currentMileage <= expiresAtMileage;
      if (!timeOk || !milesOk) continue;
      const description = String(p.name ?? "");
      out.push({
        source: "repair_order",
        sourceId: ro.id,
        sourceNumber: ro.orderNumber,
        itemType: "part",
        description,
        partNumber: p.partNumber ?? null,
        warrantyMonths: wm,
        warrantyMiles: wmi,
        startDate: start.toISOString(),
        startMileage,
        expiresOn: expires ? expires.toISOString() : null,
        expiresAtMileage,
        active: true,
      });
    }
  }

  // De-duplicate the same physical part appearing both as a completed-RO
  // jsonb entry and as a line item on the invoice generated from that RO.
  // The dedupe key includes the *day* of the start date so distinct
  // historical visits with the same part stay as separate active warranty
  // lines — only the RO-jsonb / invoice-line pair from a single visit
  // collapses into one. Within a duplicate group, the freshest startDate
  // wins (invoice line typically beats the older RO snapshot, but they
  // should match after the RO-completion fix).
  const seen = new Map<string, VehicleWarrantyEntry>();
  for (const e of out) {
    const day = e.startDate.slice(0, 10); // YYYY-MM-DD
    const key = `${e.itemType}:${e.description.toLowerCase()}:${(e.partNumber ?? "").toLowerCase()}:${day}`;
    const prev = seen.get(key);
    if (!prev || new Date(prev.startDate) < new Date(e.startDate)) seen.set(key, e);
  }
  return [...seen.values()].sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
}
