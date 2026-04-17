import { GoogleGenAI } from "@google/genai";
import * as fs from "fs";
import * as path from "path";
import { transcribe } from "./transcribe";

export type ChatTurn = { role: "user" | "assistant"; content: string };

const CHAT_MODEL = "gemini-2.5-flash";
const MAX_HISTORY_TURNS = 10;

function getClient(): GoogleGenAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set.");
  return new GoogleGenAI({ apiKey: key });
}

function loadPrompt(file: string): string {
  const compiled = path.join(__dirname, "..", "prompts", file);
  if (fs.existsSync(compiled)) return fs.readFileSync(compiled, "utf-8");
  const raw = path.join(__dirname, "..", "..", "src", "prompts", file);
  return fs.readFileSync(raw, "utf-8");
}

function extractText(response: any): string {
  if (typeof response?.text === "string" && response.text.length > 0) return response.text;
  const parts = response?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    return parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("").trim();
  }
  return "";
}

function parseJson(text: string): any {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error(`Gemini returned non-JSON: ${cleaned.slice(0, 200)}`);
  }
}

export async function chat(
  audioBuffer: Buffer,
  screenshot: Buffer | null,
  history: ChatTurn[]
): Promise<{ answer: string; transcribedQuestion: string }> {
  const transcribedQuestion = (await transcribe(audioBuffer)).trim();
  if (!transcribedQuestion || transcribedQuestion.length < 2) {
    throw new Error("I didn't catch that — try again.");
  }

  const trimmedHistory = history.slice(-MAX_HISTORY_TURNS);

  const contents: any[] = trimmedHistory.map((turn) => ({
    role: turn.role === "assistant" ? "model" : "user",
    parts: [{ text: turn.content }],
  }));

  const latestParts: any[] = [];
  if (screenshot) {
    latestParts.push({
      inlineData: { mimeType: "image/png", data: screenshot.toString("base64") },
    });
  }
  latestParts.push({ text: transcribedQuestion });
  contents.push({ role: "user", parts: latestParts });

  const ai = getClient();
  const system = loadPrompt("chat.txt");
  const response = await ai.models.generateContent({
    model: CHAT_MODEL,
    contents,
    config: {
      systemInstruction: system,
      responseMimeType: "application/json",
      temperature: 0.4,
      maxOutputTokens: 400,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const text = extractText(response);
  if (!text) throw new Error("Margaret couldn't think of an answer. Try again.");
  const parsed = parseJson(text);
  const answer = String(parsed?.answer ?? "").trim();
  if (!answer) throw new Error("Margaret returned an empty answer. Try again.");

  console.log(`[chat] Q=${JSON.stringify(transcribedQuestion).slice(0, 120)} A=${JSON.stringify(answer).slice(0, 120)}`);
  return { answer, transcribedQuestion };
}
