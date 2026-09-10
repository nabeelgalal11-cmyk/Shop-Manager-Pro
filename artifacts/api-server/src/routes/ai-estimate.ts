import { Router, type IRouter } from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";

const router: IRouter = Router();

const gemini = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

router.post("/", async (req, res) => {
  const { vehicle, repair } = req.body;

  if (!vehicle || !repair) {
    return res.status(400).json({ error: "vehicle and repair are required" });
  }

  const { year, make, model } = vehicle;

  const prompt = `You are an expert auto mechanic.

Provide a real-world repair estimate.

Vehicle: ${year} ${make} ${model}
Repair: ${repair}

Return ONLY valid JSON (no markdown, no explanation) with this exact structure:
{
  "labor_hours": "1.5 - 2.0",
  "labor_value": 1.8,
  "labor_rate": 120,
  "parts": [
    { "name": "Alternator", "type": "required", "estimated_price": 185 },
    { "name": "Drive Belt", "type": "recommended", "estimated_price": 35 }
  ],
  "fluids": ["Coolant"],
  "notes": "Moderate difficulty, access from top"
}

Rules:
- labor_hours is a readable range string
- labor_value is the midpoint number (used for billing)
- labor_rate is a typical shop rate in USD
- parts is an array; type must be "required" or "recommended"
- estimated_price for each part is approximate OEM/aftermarket price in USD
- fluids is an array of strings (empty if none needed)
- notes is a single short sentence about difficulty, access, or warnings
- Be practical. Consider rust, access difficulty, and real shop conditions.`;

  try {
    if (!gemini) {
      return res.status(503).json({
        error: "Gemini AI is not configured on the server",
      });
    }

    const model = gemini.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2,
        maxOutputTokens: 1024,
      },
    });

    const result = await model.generateContent(prompt);
    const raw = result.response.text();

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) {
        return res.status(502).json({ error: "AI returned invalid JSON", raw });
      }
      parsed = JSON.parse(match[0]);
    }

    res.json(parsed);
  } catch (err: any) {
    const providerStatus = err?.status ?? err?.response?.status;
    if (providerStatus === 429) {
      return res.status(429).json({
        error:
          "Gemini free-tier quota reached. Please wait and try again later.",
      });
    }

    console.error("Gemini estimate request failed", err);
    res.status(500).json({ error: "AI estimate request failed" });
  }
});

export default router;
