import { Router } from "express";
import { db, activityEventsTable, employeesTable, repairOrdersTable, invoicesTable, estimatesTable, customersTable } from "@workspace/db";
import { eq, and, desc, lt, sql } from "drizzle-orm";
import { getUser } from "../lib/auth.js";
import { getPermissionsForRoles, hasPermission, type Resource } from "../lib/permissions.js";
import type { ActivityEntityType } from "../lib/activity.js";

const router: Router = Router();

const ENTITY_PERMISSIONS: Record<ActivityEntityType, Resource> = {
  repair_order: "repair_orders",
  invoice: "invoices",
  estimate: "estimates",
  customer: "customers",
  vehicle: "vehicles",
  inspection: "inspections",
  appointment: "appointments",
};

const ALLOWED_ENTITY_TYPES = new Set<string>(Object.keys(ENTITY_PERMISSIONS));

async function entityExists(type: ActivityEntityType, id: number): Promise<boolean> {
  const tableMap = {
    repair_order: repairOrdersTable,
    invoice: invoicesTable,
    estimate: estimatesTable,
    customer: customersTable,
  } as const;
  const table = (tableMap as Record<string, any>)[type];
  if (!table) return true; // vehicle/inspection/appointment: skip the existence check rather than add another import
  const [row] = await db.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1);
  return !!row;
}

router.get("/", async (req, res) => {
  const entityType = String(req.query.entityType ?? "");
  const entityId = Number(req.query.entityId);
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const beforeId = req.query.beforeId ? Number(req.query.beforeId) : undefined;

  if (!ALLOWED_ENTITY_TYPES.has(entityType)) {
    return res.status(400).json({ error: "Invalid entityType" });
  }
  if (!Number.isFinite(entityId) || entityId <= 0) {
    return res.status(400).json({ error: "entityId is required" });
  }

  // Permission gate: must be able to view the underlying entity.
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  const perms = await getPermissionsForRoles(user.roles);
  const resource = ENTITY_PERMISSIONS[entityType as ActivityEntityType];
  if (!hasPermission(perms, resource, "view")) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (!(await entityExists(entityType as ActivityEntityType, entityId))) {
    return res.status(404).json({ error: "Entity not found" });
  }

  const conditions = [
    eq(activityEventsTable.entityType, entityType),
    eq(activityEventsTable.entityId, entityId),
  ];
  if (beforeId && Number.isFinite(beforeId)) {
    conditions.push(lt(activityEventsTable.id, beforeId));
  }

  const rows = await db
    .select({
      id: activityEventsTable.id,
      entityType: activityEventsTable.entityType,
      entityId: activityEventsTable.entityId,
      eventType: activityEventsTable.eventType,
      actorId: activityEventsTable.actorId,
      actorLabel: activityEventsTable.actorLabel,
      meta: activityEventsTable.meta,
      createdAt: activityEventsTable.createdAt,
      actorName: sql<string | null>`${employeesTable.firstName} || ' ' || ${employeesTable.lastName}`,
    })
    .from(activityEventsTable)
    .leftJoin(employeesTable, eq(activityEventsTable.actorId, employeesTable.id))
    .where(and(...conditions))
    .orderBy(desc(activityEventsTable.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const nextBeforeId = hasMore ? data[data.length - 1]?.id ?? null : null;

  res.json({ data, hasMore, nextBeforeId });
});

export default router;
