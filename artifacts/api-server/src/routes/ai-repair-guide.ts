import { Router, type IRouter } from "express";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

const router: IRouter = Router();

const gemini = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

router.post("/", async (req, res) => {
  const { vehicle, repair } = req.body;

  if (!vehicle || !repair?.trim()) {
    return res.status(400).json({ error: "vehicle and repair are required" });
  }

  const { year, make, model } = vehicle;
  const prompt = `You are an experienced automotive service advisor creating a practical repair guide for a professional shop.

Vehicle: ${year} ${make} ${model}
Repair or complaint: ${repair.trim()}

Return ONLY valid JSON matching the requested schema.
Create a concise, vehicle-aware guide. Do not invent exact torque values, fluid capacities, wiring pinouts, or calibration procedures. When a specification is vehicle-specific, tell the technician to verify the manufacturer service information.

Rules:
- Give 5 to 10 ordered steps.
- Each step must explain one practical action in plain language.
- Include tools, likely parts/materials, difficulty, estimated time, and safety notes.
- Include three YouTube search phrases: one for the complete job, one for the core procedure, and one for diagnosis or common mistakes.
- Do not claim that a video is verified or manufacturer-approved.
- Mention required post-repair testing or calibration when appropriate.`;

  try {
    if (!gemini) {
      return res.status(503).json({
        error: "Gemini AI is not configured on the server",
      });
    }

    const modelClient = gemini.getGenerativeModel({
      model: "gemini-flash-lite-latest",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            title: { type: SchemaType.STRING },
            overview: { type: SchemaType.STRING },
            difficulty: {
              type: SchemaType.STRING,
              format: "enum",
              enum: ["Easy", "Moderate", "Advanced"],
            },
            estimated_time: { type: SchemaType.STRING },
            tools: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.STRING },
            },
            parts: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.STRING },
            },
            steps: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  step: { type: SchemaType.INTEGER },
                  title: { type: SchemaType.STRING },
                  details: { type: SchemaType.STRING },
                },
                required: ["step", "title", "details"],
              },
            },
            safety_notes: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.STRING },
            },
            youtube_queries: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.STRING },
            },
          },
          required: [
            "title",
            "overview",
            "difficulty",
            "estimated_time",
            "tools",
            "parts",
            "steps",
            "safety_notes",
            "youtube_queries",
          ],
        },
        temperature: 0.2,
        maxOutputTokens: 2048,
      },
    });

    let result;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        result = await modelClient.generateContent(prompt);
        break;
      } catch (error: any) {
        const providerStatus = error?.status ?? error?.response?.status;
        const retryable = providerStatus === 429 || providerStatus === 503;
        if (!retryable || attempt === 2) throw error;
        await new Promise((resolve) =>
          setTimeout(resolve, 500 * (attempt + 1)),
        );
      }
    }

    if (!result) {
      throw new Error("Gemini did not return a repair guide");
    }

    const raw = result.response.text();
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) {
        return res.status(502).json({ error: "AI returned invalid guide JSON" });
      }
      parsed = JSON.parse(match[0]);
    }

    res.json(parsed);
  } catch (error: any) {
    const providerStatus = error?.status ?? error?.response?.status;
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

    console.error("Gemini repair guide request failed", error);
    res.status(500).json({ error: "Repair guide request failed" });
  }
});

export default router;