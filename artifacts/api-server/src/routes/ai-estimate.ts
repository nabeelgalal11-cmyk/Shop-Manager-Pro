import { Router, type IRouter } from "express";
import OpenAI from "openai";

const router: IRouter = Router();

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

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
    const completion = await openai.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = completion.choices[0]?.message?.content ?? "";

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
    res.status(500).json({ error: err?.message ?? "AI request failed" });
  }
});

export default router;
