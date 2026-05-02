import { Router } from "express";
import { db, rolePermissionsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAuth, requirePermission } from "../lib/auth.js";
import { ACTIONS, RESOURCES, ROLES, type Action, type Resource } from "../lib/permissions.js";

const router: Router = Router();

router.use(requireAuth);

// Get the full permissions matrix
router.get("/", requirePermission("permissions", "view"), async (_req, res) => {
  const rows = await db.select().from(rolePermissionsTable);
  // Build matrix: { role: { resource: [actions...] } }
  const matrix: Record<string, Record<string, string[]>> = {};
  for (const role of ROLES) {
    matrix[role] = {};
    for (const resource of RESOURCES) matrix[role][resource] = [];
  }
  for (const row of rows) {
    if (!matrix[row.role]) matrix[row.role] = {};
    if (!matrix[row.role][row.resource]) matrix[row.role][row.resource] = [];
    matrix[row.role][row.resource].push(row.action);
  }
  res.json({
    matrix,
    roles: ROLES,
    resources: RESOURCES,
    actions: ACTIONS,
  });
});

// Toggle a single permission cell
router.put("/", requirePermission("permissions", "edit"), async (req, res) => {
  const { role, resource, action, enabled } = req.body || {};
  if (!role || !resource || !action || typeof enabled !== "boolean") {
    return res.status(400).json({ error: "role, resource, action, enabled required" });
  }
  if (!ROLES.includes(role)) return res.status(400).json({ error: "Invalid role" });
  if (!RESOURCES.includes(resource as Resource)) return res.status(400).json({ error: "Invalid resource" });
  if (!ACTIONS.includes(action as Action)) return res.status(400).json({ error: "Invalid action" });

  // Admin role: cannot remove permissions
  if (role === "admin" && !enabled) {
    return res.status(400).json({ error: "Admin role permissions cannot be removed" });
  }

  if (enabled) {
    await db
      .insert(rolePermissionsTable)
      .values({ role, resource, action })
      .onConflictDoNothing();
  } else {
    await db
      .delete(rolePermissionsTable)
      .where(
        and(
          eq(rolePermissionsTable.role, role),
          eq(rolePermissionsTable.resource, resource),
          eq(rolePermissionsTable.action, action),
        ),
      );
  }
  res.json({ ok: true });
});

export default router;
