import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage.js";
import { requirePermission } from "../lib/auth.js";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
const MAX_PHOTO_SIZE_BYTES = 20 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/heic",
  "image/heif",
  "image/bmp",
  "image/tiff",
]);

/**
 * POST /storage/uploads/request-url
 * Request a presigned URL for direct-to-GCS upload.
 */
router.post("/storage/uploads/request-url", requirePermission("inspections", "create"), async (req: Request, res: Response) => {
  const { name, size, contentType } = req.body || {};
  if (
    typeof name !== "string" || name.length === 0 || name.length > 255 ||
    typeof size !== "number" || !Number.isFinite(size) || size <= 0 || size > MAX_PHOTO_SIZE_BYTES ||
    typeof contentType !== "string" || !ALLOWED_PHOTO_TYPES.has(contentType.toLowerCase())
  ) {
    res.status(400).json({ error: "Missing or invalid required fields: name, size, contentType" });
    return;
  }
  try {
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    res.json({ uploadURL, objectPath, metadata: { name, size, contentType } });
  } catch (error) {
    console.error("Error generating upload URL", error);
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /storage/public-objects/*
 * Serve public assets unconditionally.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath as string | string[];
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    const response = await objectStorageService.downloadObject(file);
    res.status(response.status);
    response.headers.forEach((value: string, key: string) => res.setHeader(key, value));
    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    console.error("Error serving public object", error);
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 * Serve private uploaded objects.
 */
router.get("/storage/objects/*path", requirePermission("inspections", "view"), async (req: Request, res: Response) => {
  try {
    const raw = req.params.path as string | string[];
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const [metadata] = await objectFile.getMetadata();
    const storedContentType = String(metadata.contentType || "").split(";")[0].trim().toLowerCase();
    if (!ALLOWED_PHOTO_TYPES.has(storedContentType)) {
      res.status(415).json({ error: "Unsupported private object type" });
      return;
    }
    const response = await objectStorageService.downloadObject(objectFile);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.status(response.status);
    response.headers.forEach((value: string, key: string) => res.setHeader(key, value));
    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    console.error("Error serving object", error);
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
