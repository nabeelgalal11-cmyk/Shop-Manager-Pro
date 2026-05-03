import { Router, type IRouter } from "express";

const router: IRouter = Router();

// GET /api/vin/:vin — Decode a VIN via NHTSA's free vPIC service.
router.get("/:vin", async (req, res) => {
  const vin = String(req.params.vin || "").trim().toUpperCase();
  if (vin.length < 11 || vin.length > 17) {
    return res.status(400).json({ error: "VIN must be 11–17 characters" });
  }

  try {
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/${encodeURIComponent(vin)}?format=json`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) {
      req.log.warn({ vin, status: resp.status }, "NHTSA VIN decode failed");
      return res.status(502).json({ error: "VIN service unavailable" });
    }
    const json: any = await resp.json();
    const r = json?.Results?.[0] ?? {};
    const errorCode = String(r.ErrorCode || "").split(",")[0];
    const yearNum = Number(r.ModelYear);
    const decoded = {
      vin,
      year: Number.isFinite(yearNum) && yearNum > 1900 ? yearNum : undefined,
      make: r.Make || undefined,
      model: r.Model || undefined,
      trim: r.Trim || r.Series || undefined,
      bodyClass: r.BodyClass || undefined,
      engineType: [r.EngineCylinders ? `${r.EngineCylinders} cyl` : null, r.DisplacementL ? `${Number(r.DisplacementL).toFixed(1)}L` : null, r.FuelTypePrimary]
        .filter(Boolean)
        .join(" ") || undefined,
      transmissionType: [r.TransmissionStyle, r.TransmissionSpeeds ? `${r.TransmissionSpeeds}-spd` : null]
        .filter(Boolean)
        .join(" ") || undefined,
      driveType: r.DriveType || undefined,
      manufacturer: r.Manufacturer || undefined,
      plantCountry: r.PlantCountry || undefined,
      gvwr: r.GVWR || undefined,
    };
    if (errorCode && errorCode !== "0") {
      return res.json({ ...decoded, warning: r.ErrorText || "VIN partially decoded" });
    }
    res.json(decoded);
  } catch (err: any) {
    req.log.error({ err: err?.message, vin }, "VIN decode error");
    res.status(502).json({ error: "VIN decode failed" });
  }
});

export default router;
