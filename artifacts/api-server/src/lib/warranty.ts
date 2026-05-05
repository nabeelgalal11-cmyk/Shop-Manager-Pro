import { db } from "@workspace/db";
import { inventoryTable, lineItemsTable, repairOrdersTable, invoicesTable, estimatesTable, vehiclesTable } from "@workspace/db";
import { eq, inArray, sql, and, isNotNull, desc } from "drizzle-orm";

type WarrantyFields = { warrantyMonths?: number | null; warrantyMiles?: number | null };

function pickWarranty(input: any): WarrantyFields {
  const m = input?.warrantyMonths;
  const mi = input?.warrantyMiles;
  return {
    warrantyMonths: m === null || m === "" || m === undefined ? null : Number.isFinite(Number(m)) ? Number(m) : null,
    warrantyMiles: mi === null || mi === "" || mi === undefined ? null : Number.isFinite(Number(mi)) ? Number(mi) : null,
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
export async function fillLineItemWarranties<T extends { inventoryItemId?: number | null }>(items: T[]): Promise<T[]> {
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
export async function fillRoPartsWarranties<T extends { inventoryId?: number | null }>(parts: T[]): Promise<T[]> {
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

  // 1) Line items from invoices linked to this vehicle. Source the start
  //    mileage from the linked RO's mileageOut when available so mileage
  //    expiry is honored.
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
      roMileageOut: repairOrdersTable.mileageOut,
      roMileageIn: repairOrdersTable.mileageIn,
    })
    .from(lineItemsTable)
    .leftJoin(invoicesTable, eq(invoicesTable.id, lineItemsTable.invoiceId))
    .leftJoin(repairOrdersTable, eq(repairOrdersTable.id, invoicesTable.repairOrderId))
    .where(and(
      eq(invoicesTable.vehicleId, vehicleId),
      isNotNull(lineItemsTable.invoiceId),
    ));

  // 2) Line items from estimates whose RO is completed against this vehicle.
  const roItems = await db
    .select({
      id: lineItemsTable.id,
      type: lineItemsTable.type,
      description: lineItemsTable.description,
      partNumber: lineItemsTable.partNumber,
      warrantyMonths: lineItemsTable.warrantyMonths,
      warrantyMiles: lineItemsTable.warrantyMiles,
      estimateId: lineItemsTable.estimateId,
    })
    .from(lineItemsTable)
    .where(isNotNull(lineItemsTable.estimateId));

  // 3) RO parts jsonb on completed orders for this vehicle.
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
    const start = li.invoiceCreatedAt ?? null;
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

  for (const ro of completedROs) {
    const start = ro.completedAt ?? null;
    if (!start) continue;
    const startMileage = ro.mileageOut ?? ro.mileageIn ?? null;
    const partsArr: Array<any> = Array.isArray(ro.parts) ? ro.parts : [];
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

  // De-duplicate by source + description (rare but possible if an RO has
  // both a jsonb part entry and an invoiced line item). Keep the freshest.
  const seen = new Map<string, VehicleWarrantyEntry>();
  for (const e of out) {
    const key = `${e.source}:${e.sourceId}:${e.itemType}:${e.description}:${e.partNumber ?? ""}`;
    const prev = seen.get(key);
    if (!prev || new Date(prev.startDate) < new Date(e.startDate)) seen.set(key, e);
  }
  return [...seen.values()].sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
}
