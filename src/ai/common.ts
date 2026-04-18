import { GoogleGenAI } from "@google/genai";
import * as fs from "fs";
import * as path from "path";

export type VisionInput = {
  data: Buffer;
  mimeType: "image/png" | "image/jpeg";
};

let cachedClient: GoogleGenAI | null = null;
let cachedApiKey: string | null = null;
const promptCache = new Map<string, string>();

export function getClient(): GoogleGenAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set.");
  if (!cachedClient || cachedApiKey !== key) {
    cachedClient = new GoogleGenAI({ apiKey: key });
    cachedApiKey = key;
  }
  return cachedClient;
}

export function loadPrompt(file: string): string {
  const cached = promptCache.get(file);
  if (cached) return cached;

  const compiled = path.join(__dirname, "..", "prompts", file);
  const raw = path.join(__dirname, "..", "..", "src", "prompts", file);
  const prompt = fs.readFileSync(fs.existsSync(compiled) ? compiled : raw, "utf-8");
  promptCache.set(file, prompt);
  return prompt;
}

export function extractText(response: any): string {
  if (typeof response?.text === "string" && response.text.length > 0) return response.text;
  const parts = response?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    return parts
      .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }
  return "";
}
