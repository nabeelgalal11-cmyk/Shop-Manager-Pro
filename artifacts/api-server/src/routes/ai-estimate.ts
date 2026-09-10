import { Router, type IRouter } from "express";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

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
      model: "gemini-flash-lite-latest",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            labor_hours: { type: SchemaType.STRING },
            labor_value: { type: SchemaType.NUMBER },
            labor_rate: { type: SchemaType.NUMBER },
            parts: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  name: { type: SchemaType.STRING },
                  type: {
                    type: SchemaType.STRING,
                    format: "enum",
                    enum: ["required", "recommended"],
                  },
                  estimated_price: { type: SchemaType.NUMBER },
                },
                required: ["name", "type", "estimated_price"],
              },
            },
            fluids: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.STRING },
            },
            notes: { type: SchemaType.STRING },
          },
          required: [
            "labor_hours",
            "labor_value",
            "labor_rate",
            "parts",
            "fluids",
            "notes",
          ],
        },
        temperature: 0.2,
        maxOutputTokens: 1024,
      },
    });

    let result;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        result = await model.generateContent(prompt);
        break;
      } catch (error: any) {
        const providerStatus = error?.status ?? error?.response?.status;
        const retryable = providerStatus === 429 || providerStatus === 503;
        if (!retryable || attempt === 2) {
          throw error;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, 500 * (attempt + 1)),
        );
      }
    }

    if (!result) {
      throw new Error("Gemini did not return an estimate");
    }

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
    if (providerStatus === 503) {
      return res.status(503).json({
        error: "Gemini is temporarily busy. Please try again shortly.",
      });
    }

    console.error("Gemini estimate request failed", err);
    res.status(500).json({ error: "AI estimate request failed" });
  }
});

export default router;
