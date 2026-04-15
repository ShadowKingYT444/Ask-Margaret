import { GoogleGenAI } from "@google/genai";
import * as fs from "fs";
import * as path from "path";

export type Verdict = {
  explanation: string;
  target_description: string;
  target_region:
    | "top-left"
    | "top-center"
    | "top-right"
    | "middle-left"
    | "center"
    | "middle-right"
    | "bottom-left"
    | "bottom-center"
    | "bottom-right";
  target_box: { x: number; y: number; w: number; h: number };
  confidence: "high" | "medium" | "low";
};

function getClient(): GoogleGenAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set. Add it to .env at the project root.");
  return new GoogleGenAI({ apiKey: key });
}

function loadPrompt(file: string): string {
  // In dev: dist/prompts/<file>. Fallback to src/prompts/<file>.
  const compiled = path.join(__dirname, "..", "prompts", file);
  if (fs.existsSync(compiled)) return fs.readFileSync(compiled, "utf-8");
  const raw = path.join(__dirname, "..", "..", "src", "prompts", file);
  return fs.readFileSync(raw, "utf-8");
}

const REGIONS = new Set([
  "top-left", "top-center", "top-right",
  "middle-left", "center", "middle-right",
  "bottom-left", "bottom-center", "bottom-right",
]);

function clamp01k(n: any): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 500;
  return Math.max(0, Math.min(1000, Math.round(x)));
}

function parseVerdict(text: string): Verdict {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Gemini returned non-JSON: ${cleaned.slice(0, 200)}`);
  }
  const region = REGIONS.has(parsed.target_region) ? parsed.target_region : "center";
  const box = parsed.target_box || {};
  return {
    explanation: String(parsed.explanation ?? "Sorry, I couldn't figure that out.").trim(),
    target_description: String(parsed.target_description ?? "").trim(),
    target_region: region,
    target_box: {
      x: clamp01k(box.x ?? 400),
      y: clamp01k(box.y ?? 400),
      w: clamp01k(box.w ?? 200),
      h: clamp01k(box.h ?? 200),
    },
    confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "low",
  };
}

export async function analyze(screenshot: Buffer, transcript: string): Promise<Verdict> {
  const ai = getClient();
  const system = loadPrompt("analyze_prompt.txt");

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: "image/png", data: screenshot.toString("base64") } },
          { text: `The user said: "${transcript}"` },
        ],
      },
    ],
    config: {
      systemInstruction: system,
      responseMimeType: "application/json",
      temperature: 0.3,
      maxOutputTokens: 1200,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const text = extractText(response);
  if (!text) {
    console.error("[analyze] empty gemini response:", JSON.stringify(response).slice(0, 800));
    throw new Error("Gemini returned no text. Check API key and quota.");
  }
  console.log("[analyze] gemini raw:", text.slice(0, 300));
  return parseVerdict(text);
}

function extractText(response: any): string {
  if (typeof response?.text === "string" && response.text.length > 0) return response.text;
  const parts = response?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    return parts
      .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
      .join("")
      .trim();
  }
  return "";
}

export async function analyzeFollowup(
  screenshot: Buffer,
  transcript: string,
  previous: Verdict
): Promise<Verdict> {
  const ai = getClient();
  const template = loadPrompt("followup_prompt.txt");
  const system = template
    .replace("{{PREVIOUS_TARGET}}", previous.target_description.replace(/"/g, "'"))
    .replace("{{PREVIOUS_EXPLANATION}}", previous.explanation.replace(/"/g, "'"))
    .replace("{{TRANSCRIPT}}", transcript.replace(/"/g, "'"));

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: "image/png", data: screenshot.toString("base64") } },
          { text: `Original question: "${transcript}". Please try a different target.` },
        ],
      },
    ],
    config: {
      systemInstruction: system,
      responseMimeType: "application/json",
      temperature: 0.5,
      maxOutputTokens: 1200,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const text = extractText(response);
  if (!text) throw new Error("Gemini returned no text in follow-up response.");
  return parseVerdict(text);
}
