import { Router } from "express";
import { db } from "@workspace/db";
import {
  njmvcCategoriesTable, njmvcItemsTable,
  njmvcInspectionsTable, njmvcInspectionResultsTable,
  vehiclesTable, repairOrdersTable, employeesTable,
} from "@workspace/db";
import { eq, asc, desc, and, lt, lte, gte, sql } from "drizzle-orm";

const router: Router = Router();

// ─── Seed Data ────────────────────────────────────────────────────────────────

const SEED_TEMPLATE = [
  {
    name: "Brake System", notes: null, items: [
      { label: "a. Service Brakes" },
      { label: "b. Parking Brake System" },
      { label: "c. Brake Drums or Rotors" },
      { label: "d. Brake Hose" },
      { label: "e. Brake Tubing" },
      { label: "f. Low Pressure Warning" },
      { label: "g. Air Compressor" },
      { label: "h. Vacuum Systems" },
      { label: "i. Electric Brakes" },
      { label: "j. Hydraulic Brakes" },
    ]
  },
  {
    name: "Brake Linings", notes: null, items: [
      { label: "a. L/F", hasMeasurement: true, measurementUnit: "mm" },
      { label: "b. R/F", hasMeasurement: true, measurementUnit: "mm" },
      { label: "c. L/R", hasMeasurement: true, measurementUnit: "mm" },
      { label: "d. R/R", hasMeasurement: true, measurementUnit: "mm" },
    ]
  },
  {
    name: "Lighting Devices", notes: null, items: [
      { label: "a. Headlights" },
      { label: "b. Tail Lights" },
      { label: "c. Turn Signals" },
      { label: "d. Marker/Clearance" },
      { label: "e. School Bus Warning" },
      { label: "f. Indicator" },
      { label: "g. Stop Arm/Crossing Arm" },
      { label: "h. Back Up Alarm" },
    ]
  },
  {
    name: "Glass/Glazing", notes: null, items: [
      { label: "a. Cracks" },
      { label: "b. Discoloration" },
      { label: "c. Vision Obstruction" },
    ]
  },
  {
    name: "Doors", notes: null, items: [
      { label: "a. Entry Steps" },
      { label: "b. Stepwell Light" },
      { label: "c. Door Seals" },
      { label: "d. Grab Handles" },
    ]
  },
  {
    name: "Fuel System", notes: null, items: [
      { label: "a. Visible Leak" },
      { label: "b. Fuel Tank Filler Cap Missing" },
      { label: "c. Fuel Tank Mounting" },
    ]
  },
  {
    name: "Tires", notes: null, items: [
      { label: "a. Size" },
      { label: "b. No. of Ply" },
      { label: "c. L/F", hasMeasurement: true, measurementUnit: "/32\"" },
      { label: "d. R/F", hasMeasurement: true, measurementUnit: "/32\"" },
      { label: "e. R/R/O", hasMeasurement: true, measurementUnit: "/32\"" },
      { label: "f. R/R/I", hasMeasurement: true, measurementUnit: "/32\"" },
      { label: "g. L/R/I", hasMeasurement: true, measurementUnit: "/32\"" },
      { label: "h. L/R/O", hasMeasurement: true, measurementUnit: "/32\"" },
    ]
  },
  {
    name: "Steering Mechanism", notes: null, items: [
      { label: "a. Steering System" },
      { label: "b. Steering Column" },
      { label: "c. Power Steering" },
    ]
  },
  {
    name: "Safety Equipment (If Applicable)", notes: null, items: [
      { label: "a. Fire Extinguisher" },
      { label: "b. First Aid Kit" },
      { label: "c. Portable Warning Device" },
      { label: "d. Wrecking Bar" },
    ]
  },
  {
    name: "Underbody", notes: null, items: [
      { label: "a. Drive Shaft/Guards" },
      { label: "b. Spring Assembly" },
      { label: "c. Crossmembers" },
      { label: "d. Body Clips/Bolts" },
      { label: "e. Shocks" },
      { label: "f. Fluid Leaks" },
      { label: "g. Undercoating" },
      { label: "h. Carrier Bearings" },
    ]
  },
  {
    name: "Wipers", notes: null, items: [
      { label: "a. Wiper Inoperable" },
      { label: "b. Washer Inoperable" },
      { label: "c. Wiper Blades" },
      { label: "d. Wiper Sweep" },
    ]
  },
  {
    name: "Exhaust System", notes: null, items: [
      { label: "a. Mounting" },
      { label: "b. Leaks" },
    ]
  },
  {
    name: "Transmission", notes: null, items: [
      { label: "Transmission" },
    ]
  },
  {
    name: "Bus Exterior", notes: null, items: [
      { label: "a. Condition" },
      { label: "b. Bumpers" },
      { label: "c. Rub Rails" },
    ]
  },
  {
    name: "Underhood", notes: null, items: [
      { label: "a. Belts" },
      { label: "b. Hoses" },
      { label: "c. Battery" },
      { label: "d. Antifreeze Leak" },
      { label: "e. Oil Leak" },
    ]
  },
  {
    name: "Emergency Exit", notes: null, items: [
      { label: "a. Lettering" },
      { label: "b. Buzzers" },
      { label: "c. Landing Lights" },
      { label: "d. Door Slide Bar" },
      { label: "e. Door Handles" },
    ]
  },
  {
    name: "Bus Interior", notes: null, items: [
      { label: "a. Instruments" },
      { label: "b. Heaters" },
      { label: "c. Defrosters" },
      { label: "d. Lights" },
      { label: "e. Cleanliness" },
      { label: "f. Seats" },
    ]
  },
  {
    name: "Differential", notes: null, items: [
      { label: "Differential" },
    ]
  },
  {
    name: "Mirrors", notes: null, items: [
      { label: "a. Crossover" },
      { label: "b. Rearview/Convex" },
      { label: "c. Interior" },
      { label: "d. Mirror Adjustment" },
    ]
  },
  {
    name: "Handicapped (If Applicable)", notes: null, items: [
      { label: "a. Power Lift" },
      { label: "b. Lift Door" },
      { label: "c. Buzzer" },
      { label: "d. Interlock" },
      { label: "e. Identification" },
      { label: "f. Light" },
      { label: "g. Fluid Leaks" },
      { label: "h. Manual Pump" },
    ]
  },
];

export async function seedNjmvcTemplate() {
  const existing = await db.select({ id: njmvcCategoriesTable.id }).from(njmvcCategoriesTable).limit(1);
  if (existing.length > 0) return;

  console.log("[NJMVC] Seeding default inspection template...");
  for (let i = 0; i < SEED_TEMPLATE.length; i++) {
    const cat = SEED_TEMPLATE[i];
    const [inserted] = await db.insert(njmvcCategoriesTable).values({
      name: cat.name,
      sortOrder: i,
      active: true,
      notes: cat.notes,
    }).returning();

    if (cat.items.length > 0) {
      await db.insert(njmvcItemsTable).values(
        cat.items.map((item: any, j: number) => ({
          categoryId: inserted.id,
          label: item.label,
          hasMeasurement: item.hasMeasurement ?? false,
          measurementUnit: item.measurementUnit ?? null,
          sortOrder: j,
          active: true,
        }))
      );
    }
  }
  console.log("[NJMVC] Template seeded successfully.");
}

// ─── Template API ─────────────────────────────────────────────────────────────

// GET /api/njmvc/template — full template with nested items
router.get("/template", async (_req, res) => {
  const categories = await db.select().from(njmvcCategoriesTable).orderBy(asc(njmvcCategoriesTable.sortOrder));
  const items = await db.select().from(njmvcItemsTable).orderBy(asc(njmvcItemsTable.sortOrder));

  const result = categories.map(cat => ({
    ...cat,
    items: items.filter(item => item.categoryId === cat.id),
  }));
  res.json(result);
});

// GET /api/njmvc/categories — returns categories with nested items (sorted)
router.get("/categories", async (_req, res) => {
  const categories = await db.select().from(njmvcCategoriesTable).orderBy(asc(njmvcCategoriesTable.sortOrder));
  const items = await db.select().from(njmvcItemsTable).orderBy(asc(njmvcItemsTable.sortOrder));
  const result = categories.map(cat => ({
    ...cat,
    items: items.filter(item => item.categoryId === cat.id),
  }));
  res.json(result);
});

// POST /api/njmvc/categories
router.post("/categories", async (req, res) => {
  const { name, sortOrder, active, notes } = req.body;
  const [cat] = await db.insert(njmvcCategoriesTable).values({ name, sortOrder: sortOrder ?? 999, active: active ?? true, notes }).returning();
  res.status(201).json(cat);
});

// PUT /api/njmvc/categories/:id
router.put("/categories/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name, sortOrder, active, notes } = req.body;
  const [cat] = await db.update(njmvcCategoriesTable)
    .set({ name, sortOrder, active, notes, updatedAt: new Date() })
    .where(eq(njmvcCategoriesTable.id, id))
    .returning();
  if (!cat) return res.status(404).json({ error: "Category not found" });
  res.json(cat);
});

// DELETE /api/njmvc/categories/:id — deactivates if results exist, otherwise hard-deletes
router.delete("/categories/:id", async (req, res) => {
  const id = Number(req.params.id);
  // Check if any inspection results reference items in this category
  const itemIds = await db.select({ id: njmvcItemsTable.id })
    .from(njmvcItemsTable)
    .where(eq(njmvcItemsTable.categoryId, id));
  if (itemIds.length > 0) {
    const ids = itemIds.map(i => i.id);
    const countResult = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*) as count FROM njmvc_inspection_results WHERE item_id = ANY(${ids})`
    );
    const count = countResult.rows[0]?.count ?? "0";
    if (Number(count) > 0) {
      // Results exist — soft-delete (deactivate) to preserve historical data
      await db.update(njmvcCategoriesTable)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(njmvcCategoriesTable.id, id));
      return res.status(200).json({ deactivated: true, reason: "Historical results reference items in this category." });
    }
  }
  await db.delete(njmvcCategoriesTable).where(eq(njmvcCategoriesTable.id, id));
  res.status(204).send();
});

// GET /api/njmvc/items
router.get("/items", async (req, res) => {
  const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;
  const items = categoryId
    ? await db.select().from(njmvcItemsTable).where(eq(njmvcItemsTable.categoryId, categoryId)).orderBy(asc(njmvcItemsTable.sortOrder))
    : await db.select().from(njmvcItemsTable).orderBy(asc(njmvcItemsTable.sortOrder));
  res.json(items);
});

// POST /api/njmvc/items
router.post("/items", async (req, res) => {
  const { categoryId, label, hasMeasurement, measurementUnit, sortOrder, active } = req.body;
  const [item] = await db.insert(njmvcItemsTable).values({
    categoryId: Number(categoryId), label,
    hasMeasurement: hasMeasurement ?? false,
    measurementUnit: measurementUnit ?? null,
    sortOrder: sortOrder ?? 999,
    active: active ?? true,
  }).returning();
  res.status(201).json(item);
});

// PUT /api/njmvc/items/:id
router.put("/items/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { label, hasMeasurement, measurementUnit, sortOrder, active } = req.body;
  const [item] = await db.update(njmvcItemsTable)
    .set({ label, hasMeasurement, measurementUnit, sortOrder, active })
    .where(eq(njmvcItemsTable.id, id))
    .returning();
  if (!item) return res.status(404).json({ error: "Item not found" });
  res.json(item);
});

// DELETE /api/njmvc/items/:id — deactivates if results exist, otherwise hard-deletes
router.delete("/items/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [{ count }] = await db.select({ count: sql<number>`count(*)` })
    .from(njmvcInspectionResultsTable)
    .where(eq(njmvcInspectionResultsTable.itemId, id));
  if (Number(count) > 0) {
    const [item] = await db.update(njmvcItemsTable)
      .set({ active: false })
      .where(eq(njmvcItemsTable.id, id))
      .returning();
    return res.status(200).json({ deactivated: true, item });
  }
  await db.delete(njmvcItemsTable).where(eq(njmvcItemsTable.id, id));
  res.status(204).send();
});

// ─── Inspections API ──────────────────────────────────────────────────────────

async function enrichInspection(insp: any) {
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, insp.vehicleId));
  return { ...insp, vehicle };
}

// GET /api/njmvc/inspections
// Query params: vehicleId, dateFrom (ISO date), dateTo (ISO date), page, limit
router.get("/inspections", async (req, res) => {
  const vehicleId = req.query.vehicleId ? Number(req.query.vehicleId) : undefined;
  const dateFrom = req.query.dateFrom ? String(req.query.dateFrom) : undefined;
  const dateTo = req.query.dateTo ? String(req.query.dateTo) : undefined;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Number(req.query.limit) || 50);
  const offset = (page - 1) * limit;

  const conditions: any[] = [];
  if (vehicleId) conditions.push(eq(njmvcInspectionsTable.vehicleId, vehicleId));
  if (dateFrom) conditions.push(gte(njmvcInspectionsTable.inspectionDate, dateFrom));
  if (dateTo) conditions.push(lte(njmvcInspectionsTable.inspectionDate, dateTo));

  const baseQuery = conditions.length > 0
    ? db.select().from(njmvcInspectionsTable).where(and(...conditions))
    : db.select().from(njmvcInspectionsTable);

  const inspections = await baseQuery.orderBy(desc(njmvcInspectionsTable.inspectionDate)).limit(limit).offset(offset);

  // Count with same filters for accurate pagination
  const countQuery = conditions.length > 0
    ? db.select({ count: sql<number>`count(*)` }).from(njmvcInspectionsTable).where(and(...conditions))
    : db.select({ count: sql<number>`count(*)` }).from(njmvcInspectionsTable);
  const [{ count }] = await countQuery;

  const enriched = await Promise.all(inspections.map(enrichInspection));
  res.json({ data: enriched, total: Number(count), page, limit });
});

// POST /api/njmvc/inspections
router.post("/inspections", async (req, res) => {
  const {
    vehicleId, operatorName, address, mechanicNamePrint, mechanicNameSigned,
    reportNumber, fleetUnitNumber, mileage, vehicleType, vin, licensePlate,
    inspectionDate, certifiedPassed, notes, results = [],
  } = req.body;

  const [insp] = await db.insert(njmvcInspectionsTable).values({
    vehicleId: Number(vehicleId), operatorName, address, mechanicNamePrint,
    mechanicNameSigned, reportNumber, fleetUnitNumber,
    mileage: mileage ? Number(mileage) : null,
    vehicleType, vin, licensePlate, inspectionDate,
    purchaseDate: req.body.purchaseDate || null,
    certifiedPassed: certifiedPassed ?? false, notes,
  }).returning();

  if (results.length > 0) {
    await db.insert(njmvcInspectionResultsTable).values(
      results.map((r: any) => ({
        inspectionId: insp.id,
        itemId: Number(r.itemId),
        status: r.status || null,
        repairedDate: r.repairedDate || null,
        measurementValue: r.measurementValue || null,
        notes: r.notes || null,
      }))
    );
  }

  res.status(201).json(await getFullInspection(insp.id));
});

// GET /api/njmvc/inspections/:id
router.get("/inspections/:id", async (req, res) => {
  const id = Number(req.params.id);
  const data = await getFullInspection(id);
  if (!data) return res.status(404).json({ error: "Inspection not found" });
  res.json(data);
});

async function getFullInspection(id: number) {
  const [insp] = await db.select().from(njmvcInspectionsTable).where(eq(njmvcInspectionsTable.id, id));
  if (!insp) return null;

  const [vehicle, results, categories, items] = await Promise.all([
    db.select().from(vehiclesTable).where(eq(vehiclesTable.id, insp.vehicleId)).then(r => r[0]),
    db.select().from(njmvcInspectionResultsTable).where(eq(njmvcInspectionResultsTable.inspectionId, id)),
    db.select().from(njmvcCategoriesTable).orderBy(asc(njmvcCategoriesTable.sortOrder)),
    db.select().from(njmvcItemsTable).orderBy(asc(njmvcItemsTable.sortOrder)),
  ]);

  const resultsByItemId = Object.fromEntries(results.map(r => [r.itemId, r]));
  const templateWithResults = categories.map(cat => ({
    ...cat,
    items: items.filter(item => item.categoryId === cat.id).map(item => ({
      ...item,
      result: resultsByItemId[item.id] || null,
    })),
  }));

  return { ...insp, vehicle, template: templateWithResults };
}

// PUT /api/njmvc/inspections/:id
router.put("/inspections/:id", async (req, res) => {
  const id = Number(req.params.id);
  const {
    vehicleId, operatorName, address, mechanicNamePrint, mechanicNameSigned,
    reportNumber, fleetUnitNumber, mileage, vehicleType, vin, licensePlate,
    inspectionDate, certifiedPassed, notes, results,
  } = req.body;

  const [insp] = await db.update(njmvcInspectionsTable).set({
    vehicleId: vehicleId ? Number(vehicleId) : undefined,
    operatorName, address, mechanicNamePrint, mechanicNameSigned,
    reportNumber, fleetUnitNumber,
    mileage: mileage != null ? Number(mileage) : null,
    vehicleType, vin, licensePlate, inspectionDate,
    purchaseDate: req.body.purchaseDate || null,
    certifiedPassed: certifiedPassed ?? false, notes,
    updatedAt: new Date(),
  }).where(eq(njmvcInspectionsTable.id, id)).returning();

  if (!insp) return res.status(404).json({ error: "Inspection not found" });

  if (Array.isArray(results)) {
    await db.delete(njmvcInspectionResultsTable).where(eq(njmvcInspectionResultsTable.inspectionId, id));
    if (results.length > 0) {
      await db.insert(njmvcInspectionResultsTable).values(
        results.map((r: any) => ({
          inspectionId: id,
          itemId: Number(r.itemId),
          status: r.status || null,
          repairedDate: r.repairedDate || null,
          measurementValue: r.measurementValue || null,
          notes: r.notes || null,
        }))
      );
    }
  }

  res.json(await getFullInspection(id));
});

// DELETE /api/njmvc/inspections/:id
router.delete("/inspections/:id", async (req, res) => {
  await db.delete(njmvcInspectionsTable).where(eq(njmvcInspectionsTable.id, Number(req.params.id)));
  res.status(204).send();
});

// Helper: query COMPLETED repair orders for a vehicle with completedAt in the window
async function queryRelatedRepairs(vehicleId: number, sinceDate: Date | null, untilDate: Date | null) {
  const conditions: any[] = [
    eq(repairOrdersTable.vehicleId, vehicleId),
    sql`${repairOrdersTable.completedAt} IS NOT NULL`,
  ];

  if (sinceDate) {
    conditions.push(gte(repairOrdersTable.completedAt, sinceDate));
  }
  if (untilDate) {
    conditions.push(lte(repairOrdersTable.completedAt, untilDate));
  }

  return db.select({
    id: repairOrdersTable.id,
    orderNumber: repairOrdersTable.orderNumber,
    complaint: repairOrdersTable.complaint,
    diagnosis: repairOrdersTable.diagnosis,
    status: repairOrdersTable.status,
    parts: repairOrdersTable.parts,
    completedAt: repairOrdersTable.completedAt,
    createdAt: repairOrdersTable.createdAt,
    technicianFirstName: employeesTable.firstName,
    technicianLastName: employeesTable.lastName,
  })
  .from(repairOrdersTable)
  .leftJoin(employeesTable, eq(repairOrdersTable.assignedToId, employeesTable.id))
  .where(and(...conditions))
  .orderBy(desc(repairOrdersTable.completedAt));
}

// GET /api/njmvc/vehicles/:vehicleId/related-repairs — for new inspections (no ID yet)
// Query params: sinceDate (ISO string), untilDate (ISO string)
router.get("/vehicles/:vehicleId/related-repairs", async (req, res) => {
  const vehicleId = Number(req.params.vehicleId);
  const untilDate = req.query.untilDate ? new Date(req.query.untilDate as string) : new Date();

  // Find the most recent inspection for this vehicle as the lower bound
  const [lastInsp] = await db.select()
    .from(njmvcInspectionsTable)
    .where(eq(njmvcInspectionsTable.vehicleId, vehicleId))
    .orderBy(desc(njmvcInspectionsTable.inspectionDate))
    .limit(1);

  const sinceDate = lastInsp?.inspectionDate ? new Date(lastInsp.inspectionDate) : null;

  const rows = await queryRelatedRepairs(vehicleId, sinceDate, untilDate);
  res.json({
    sinceDate,
    untilDate,
    previousInspectionId: lastInsp?.id ?? null,
    repairOrders: rows.map(ro => ({
      ...ro,
      technician: ro.technicianFirstName
        ? `${ro.technicianFirstName} ${ro.technicianLastName}`
        : null,
    })),
  });
});

// GET /api/njmvc/inspections/:id/related-repairs
router.get("/inspections/:id/related-repairs", async (req, res) => {
  const id = Number(req.params.id);
  const [insp] = await db.select().from(njmvcInspectionsTable).where(eq(njmvcInspectionsTable.id, id));
  if (!insp) return res.status(404).json({ error: "Inspection not found" });

  // Use inspectionDate as the upper bound (what the form says, not createdAt)
  const untilDate = insp.inspectionDate ? new Date(insp.inspectionDate) : insp.createdAt;

  // Find the previous inspection for this vehicle — use inspectionDate for comparison
  const [prevInsp] = await db.select()
    .from(njmvcInspectionsTable)
    .where(and(
      eq(njmvcInspectionsTable.vehicleId, insp.vehicleId),
      sql`id <> ${id}`,
      sql`COALESCE(inspection_date::timestamp, created_at) < ${untilDate}`
    ))
    .orderBy(desc(njmvcInspectionsTable.inspectionDate))
    .limit(1);

  const sinceDate = prevInsp?.inspectionDate
    ? new Date(prevInsp.inspectionDate)
    : prevInsp?.createdAt ?? null;

  const rows = await queryRelatedRepairs(insp.vehicleId, sinceDate, untilDate);

  res.json({
    sinceDate,
    untilDate,
    previousInspectionId: prevInsp?.id ?? null,
    repairOrders: rows.map(ro => ({
      ...ro,
      technician: ro.technicianFirstName
        ? `${ro.technicianFirstName} ${ro.technicianLastName}`
        : null,
    })),
  });
});

export default router;
