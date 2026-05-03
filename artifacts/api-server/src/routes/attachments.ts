import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import {
  db, attachmentsTable, employeesTable,
  repairOrdersTable, invoicesTable, estimatesTable, inspectionsTable, vehiclesTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  uploadBuffer,
  downloadStream,
  deleteFile,
  isConfigured,
  HostgatorStorageError,
} from "../lib/hostgatorStorage.js";
import { recordActivity, type ActivityEntityType } from "../lib/activity.js";

const OWNER_TO_ACTIVITY_ENTITY: Partial<Record<string, ActivityEntityType>> = {
  repair_order: "repair_order",
  inspection: "inspection",
  estimate: "estimate",
  invoice: "invoice",
  vehicle: "vehicle",
  customer: "customer",
};

const router: IRouter = Router();

const ALLOWED_OWNER_TYPES = new Set([
  "repair_order",
  "inspection",
  "purchase",
  "estimate",
  "invoice",
  "vehicle",
  "customer",
  "expense",
  "used_car",
]);

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
const ALLOWED_MIME_PREFIXES = ["image/", "application/pdf"];
const ALLOWED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (_req, file, cb) => {
    const mime = file.mimetype.toLowerCase();
    const ok =
      ALLOWED_MIMES.has(mime) ||
      ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p));
    if (!ok) {
      cb(new Error(`File type not allowed: ${mime}`));
      return;
    }
    cb(null, true);
  },
});

function validateOwnerType(t: unknown): asserts t is string {
  if (typeof t !== "string" || !ALLOWED_OWNER_TYPES.has(t)) {
    throw Object.assign(new Error("Invalid ownerType"), { status: 400 });
  }
}

async function resolveCustomerIdForOwner(
  ownerType: string,
  ownerId: number,
): Promise<number | null> {
  try {
    if (ownerType === "customer") return ownerId;
    if (ownerType === "repair_order") {
      const [r] = await db.select({ customerId: repairOrdersTable.customerId }).from(repairOrdersTable).where(eq(repairOrdersTable.id, ownerId));
      return r?.customerId ?? null;
    }
    if (ownerType === "invoice") {
      const [r] = await db.select({ customerId: invoicesTable.customerId }).from(invoicesTable).where(eq(invoicesTable.id, ownerId));
      return r?.customerId ?? null;
    }
    if (ownerType === "estimate") {
      const [r] = await db.select({ customerId: estimatesTable.customerId }).from(estimatesTable).where(eq(estimatesTable.id, ownerId));
      return r?.customerId ?? null;
    }
    if (ownerType === "inspection") {
      const [r] = await db.select({ vehicleId: inspectionsTable.vehicleId }).from(inspectionsTable).where(eq(inspectionsTable.id, ownerId));
      if (!r?.vehicleId) return null;
      const [v] = await db.select({ customerId: vehiclesTable.customerId }).from(vehiclesTable).where(eq(vehiclesTable.id, r.vehicleId));
      return v?.customerId ?? null;
    }
    if (ownerType === "vehicle") {
      const [r] = await db.select({ customerId: vehiclesTable.customerId }).from(vehiclesTable).where(eq(vehiclesTable.id, ownerId));
      return r?.customerId ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

router.get("/", async (req: Request, res: Response) => {
  const ownerType = String(req.query.ownerType || "");
  const ownerId = Number(req.query.ownerId);
  if (!ownerType || !Number.isFinite(ownerId)) {
    res.status(400).json({ error: "ownerType and ownerId are required" });
    return;
  }
  try {
    validateOwnerType(ownerType);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
    return;
  }

  const rows = await db
    .select({
      id: attachmentsTable.id,
      ownerType: attachmentsTable.ownerType,
      ownerId: attachmentsTable.ownerId,
      fileName: attachmentsTable.fileName,
      mimeType: attachmentsTable.mimeType,
      size: attachmentsTable.size,
      notes: attachmentsTable.notes,
      uploadedById: attachmentsTable.uploadedById,
      createdAt: attachmentsTable.createdAt,
      uploadedByName: sql<string | null>`${employeesTable.firstName} || ' ' || ${employeesTable.lastName}`,
    })
    .from(attachmentsTable)
    .leftJoin(employeesTable, eq(attachmentsTable.uploadedById, employeesTable.id))
    .where(and(eq(attachmentsTable.ownerType, ownerType), eq(attachmentsTable.ownerId, ownerId)))
    .orderBy(desc(attachmentsTable.createdAt));

  res.json({ data: rows });
});

router.post("/", upload.single("file"), async (req: Request, res: Response) => {
  if (!isConfigured()) {
    res.status(503).json({ error: "Attachment storage is not configured on the server." });
    return;
  }
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  const ownerType = String(req.body.ownerType || "");
  const ownerId = Number(req.body.ownerId);
  const notes = req.body.notes ? String(req.body.notes) : null;
  if (!ownerType || !Number.isFinite(ownerId)) {
    res.status(400).json({ error: "ownerType and ownerId are required" });
    return;
  }
  try {
    validateOwnerType(ownerType);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
    return;
  }

  try {
    const { storagePath } = await uploadBuffer({
      ownerType,
      ownerId,
      originalName: file.originalname,
      buffer: file.buffer,
      mimeType: file.mimetype,
    });

    const [row] = await db
      .insert(attachmentsTable)
      .values({
        ownerType,
        ownerId,
        fileName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        storagePath,
        notes,
        uploadedById: req.session?.userId ?? null,
      })
      .returning();

    const activityEntity = OWNER_TO_ACTIVITY_ENTITY[ownerType];
    if (activityEntity) {
      const customerId = await resolveCustomerIdForOwner(ownerType, ownerId);
      await recordActivity({
        entityType: activityEntity,
        entityId: ownerId,
        eventType: "attachment_uploaded",
        meta: { attachmentId: row.id, fileName: row.fileName, mimeType: row.mimeType, size: row.size },
        customerId,
        req,
      });
    }

    res.status(201).json(row);
  } catch (err: any) {
    req.log?.error({ err }, "attachment upload failed");
    const msg =
      err instanceof HostgatorStorageError
        ? err.message
        : err?.message || "Upload failed";
    res.status(500).json({ error: msg });
  }
});

router.get("/:id/download", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const ownerType = String(req.query.ownerType || "");
  const ownerId = Number(req.query.ownerId);
  if (!ownerType || !Number.isFinite(ownerId)) {
    res.status(400).json({ error: "ownerType and ownerId are required" });
    return;
  }
  try {
    validateOwnerType(ownerType);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
    return;
  }
  const [row] = await db
    .select()
    .from(attachmentsTable)
    .where(
      and(
        eq(attachmentsTable.id, id),
        eq(attachmentsTable.ownerType, ownerType),
        eq(attachmentsTable.ownerId, ownerId),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "Attachment not found" });
    return;
  }

  try {
    const { stream, cleanup } = await downloadStream(row.storagePath);
    res.setHeader("Content-Type", row.mimeType);
    res.setHeader("Content-Length", String(row.size));
    const disposition = req.query.download === "1" ? "attachment" : "inline";
    res.setHeader(
      "Content-Disposition",
      `${disposition}; filename="${row.fileName.replace(/"/g, "")}"`
    );
    res.setHeader("Cache-Control", "private, max-age=300");
    stream.on("end", () => {
      void cleanup();
    });
    stream.on("error", () => {
      void cleanup();
    });
    stream.pipe(res);
  } catch (err: any) {
    req.log?.error({ err }, "attachment download failed");
    const msg =
      err instanceof HostgatorStorageError
        ? err.message
        : err?.message || "Download failed";
    if (!res.headersSent) {
      res.status(500).json({ error: msg });
    }
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const ownerType = String(req.query.ownerType || "");
  const ownerId = Number(req.query.ownerId);
  if (!ownerType || !Number.isFinite(ownerId)) {
    res.status(400).json({ error: "ownerType and ownerId are required" });
    return;
  }
  try {
    validateOwnerType(ownerType);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
    return;
  }
  const [row] = await db
    .select()
    .from(attachmentsTable)
    .where(
      and(
        eq(attachmentsTable.id, id),
        eq(attachmentsTable.ownerType, ownerType),
        eq(attachmentsTable.ownerId, ownerId),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "Attachment not found" });
    return;
  }
  try {
    await deleteFile(row.storagePath);
  } catch (err) {
    req.log?.warn({ err, storagePath: row.storagePath }, "storage delete failed; removing DB row anyway");
  }
  await db.delete(attachmentsTable).where(eq(attachmentsTable.id, id));

  const activityEntity = OWNER_TO_ACTIVITY_ENTITY[ownerType];
  if (activityEntity) {
    const customerId = await resolveCustomerIdForOwner(ownerType, ownerId);
    await recordActivity({
      entityType: activityEntity,
      entityId: ownerId,
      eventType: "attachment_deleted",
      meta: { attachmentId: id, fileName: row.fileName },
      customerId,
      req,
    });
  }
  res.status(204).end();
});

export default router;
