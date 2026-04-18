import { extractText, getClient, loadPrompt, VisionInput } from "./common";

// Gemini returns boxes as [ymin, xmin, ymax, xmax] normalized 0-1000.
// We keep the internal Verdict in {x,y,w,h} (0-1000) so the renderer
// does not have to care about the format.

export type Mode = "help_click" | "scam_check" | "read_explain" | "walkthrough";

export type ClickVerdict = {
  mode: "help_click" | "walkthrough";
  explanation: string;
  target_description: string;
  target_label: string;
  target_box: { x: number; y: number; w: number; h: number };
  confidence: "high" | "medium" | "low";
  // walkthrough extras
  goal?: string;
  steps?: string[];
  current_step?: number;
  total_steps?: number;
  suggested_text?: string;
};

export type ScamVerdict = {
  mode: "scam_check";
  verdict: "danger" | "caution" | "safe";
  headline: string;
  reasons: string[];
  what_to_do: string;
  confidence: "high" | "medium" | "low";
};

export type ReadVerdict = {
  mode: "read_explain";
  kind: string;
  title: string;
  summary: string;
  bullets: string[];
  action_needed: string;
  read_aloud: string;
};

export type Verdict = ClickVerdict | ScamVerdict | ReadVerdict;

const ANALYZE_MODEL = "gemini-2.5-flash";
const ROUTER_MODEL = "gemini-2.5-flash";

function parseJson(text: string): any {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to salvage the first {...} block.
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error(`Gemini returned non-JSON: ${cleaned.slice(0, 200)}`);
  }
}

function clamp01k(n: any, fallback: number): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(0, Math.min(1000, Math.round(x)));
}

// box_2d is [ymin, xmin, ymax, xmax] in 0-1000 image coords.
function normalizeBox2d(raw: any): { x: number; y: number; w: number; h: number } {
  if (Array.isArray(raw) && raw.length >= 4) {
    const ymin = clamp01k(raw[0], 400);
    const xmin = clamp01k(raw[1], 400);
    const ymax = clamp01k(raw[2], 600);
    const xmax = clamp01k(raw[3], 600);
    const y = Math.min(ymin, ymax);
    const x = Math.min(xmin, xmax);
    const h = Math.max(10, Math.abs(ymax - ymin));
    const w = Math.max(10, Math.abs(xmax - xmin));
    return { x, y, w, h };
  }
  // Back-compat for older {x,y,w,h}.
  if (raw && typeof raw === "object") {
    return {
      x: clamp01k(raw.x, 400),
      y: clamp01k(raw.y, 400),
      w: clamp01k(raw.w, 200),
      h: clamp01k(raw.h, 200),
    };
  }
  return { x: 400, y: 400, w: 200, h: 200 };
}

async function callGemini(
  model: string,
  system: string,
  screenshot: VisionInput,
  userText: string,
  thinkingBudget: number | null
): Promise<string> {
  const ai = getClient();
  const config: any = {
    systemInstruction: system,
    responseMimeType: "application/json",
    temperature: 0.2,
    maxOutputTokens: 2000,
  };
  if (thinkingBudget !== null) config.thinkingConfig = { thinkingBudget };
  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: screenshot.mimeType, data: screenshot.data.toString("base64") } },
          { text: userText },
        ],
      },
    ],
    config,
  });
  const text = extractText(response);
  if (!text) throw new Error("Gemini returned no text.");
  return text;
}

export async function classifyMode(screenshot: VisionInput, transcript: string): Promise<Mode> {
  try {
    const system = loadPrompt("router_prompt.txt");
    const text = await callGemini(ROUTER_MODEL, system, screenshot, `User said: "${transcript}"`, 0);
    const parsed = parseJson(text);
    const mode = parsed?.mode;
    if (mode === "help_click" || mode === "scam_check" || mode === "read_explain" || mode === "walkthrough") {
      console.log(`[router] ${mode}: ${parsed.reason}`);
      return mode;
    }
  } catch (e: any) {
    console.warn("[router] failed, defaulting help_click:", e?.message);
  }
  return "help_click";
}

function parseClickVerdict(text: string, mode: "help_click" | "walkthrough"): ClickVerdict {
  const parsed = parseJson(text);
  const box = normalizeBox2d(parsed.box_2d ?? parsed.target_box);
  const out: ClickVerdict = {
    mode,
    explanation: String(parsed.explanation ?? parsed.now_do ?? "Here is the next step.").trim(),
    target_description: String(parsed.target_description ?? "").trim(),
    target_label: String(parsed.target_label ?? "").trim(),
    target_box: box,
    confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "low",
  };
  if (mode === "walkthrough") {
    out.goal = String(parsed.goal ?? "").trim();
    out.steps = Array.isArray(parsed.steps) ? parsed.steps.map((s: any) => String(s)).slice(0, 10) : [];
    out.current_step = Number.isFinite(parsed.current_step) ? Number(parsed.current_step) : 1;
    out.total_steps = Number.isFinite(parsed.total_steps) ? Number(parsed.total_steps) : (out.steps?.length ?? 1);
    out.suggested_text = String(parsed.suggested_text ?? "").trim();
    if (!out.explanation && parsed.now_do) out.explanation = String(parsed.now_do).trim();
  }
  return out;
}

function parseScamVerdict(text: string): ScamVerdict {
  const p = parseJson(text);
  const verdict = ["danger", "caution", "safe"].includes(p.verdict) ? p.verdict : "caution";
  return {
    mode: "scam_check",
    verdict,
    headline: String(p.headline ?? "").trim(),
    reasons: Array.isArray(p.reasons) ? p.reasons.map((r: any) => String(r)).slice(0, 5) : [],
    what_to_do: String(p.what_to_do ?? "").trim(),
    confidence: ["high", "medium", "low"].includes(p.confidence) ? p.confidence : "medium",
  };
}

function parseReadVerdict(text: string): ReadVerdict {
  const p = parseJson(text);
  return {
    mode: "read_explain",
    kind: String(p.kind ?? "other").trim(),
    title: String(p.title ?? "").trim(),
    summary: String(p.summary ?? "").trim(),
    bullets: Array.isArray(p.bullets) ? p.bullets.map((b: any) => String(b)).slice(0, 6) : [],
    action_needed: String(p.action_needed ?? "").trim(),
    read_aloud: String(p.read_aloud ?? p.summary ?? "").trim(),
  };
}

async function analyzeClick(screenshot: VisionInput, transcript: string): Promise<ClickVerdict> {
  const system = loadPrompt("analyze_prompt.txt");
  const text = await callGemini(
    ANALYZE_MODEL,
    system,
    screenshot,
    `The user said: "${transcript}"`,
    0
  );
  console.log("[analyze click] raw:", text.slice(0, 300));
  return parseClickVerdict(text, "help_click");
}

async function analyzeScam(screenshot: VisionInput, transcript: string): Promise<ScamVerdict> {
  const system = loadPrompt("scam_prompt.txt");
  const text = await callGemini(
    ANALYZE_MODEL,
    system,
    screenshot,
    `The user is worried and said: "${transcript}"`,
    0
  );
  console.log("[analyze scam] raw:", text.slice(0, 300));
  return parseScamVerdict(text);
}

async function analyzeRead(screenshot: VisionInput, transcript: string): Promise<ReadVerdict> {
  const system = loadPrompt("read_prompt.txt");
  const text = await callGemini(
    ANALYZE_MODEL,
    system,
    screenshot,
    `The user said: "${transcript}"`,
    0
  );
  console.log("[analyze read] raw:", text.slice(0, 300));
  return parseReadVerdict(text);
}

async function analyzeWalkthrough(screenshot: VisionInput, transcript: string): Promise<ClickVerdict> {
  const system = loadPrompt("walkthrough_prompt.txt");
  const text = await callGemini(
    ANALYZE_MODEL,
    system,
    screenshot,
    `The user said: "${transcript}"`,
    0
  );
  console.log("[analyze walk] raw:", text.slice(0, 300));
  return parseClickVerdict(text, "walkthrough");
}

export async function analyze(screenshot: VisionInput, transcript: string): Promise<Verdict> {
  const mode = await classifyMode(screenshot, transcript);
  switch (mode) {
    case "scam_check":
      return analyzeScam(screenshot, transcript);
    case "read_explain":
      return analyzeRead(screenshot, transcript);
    case "walkthrough":
      return analyzeWalkthrough(screenshot, transcript);
    case "help_click":
    default:
      return analyzeClick(screenshot, transcript);
  }
}

export async function analyzeFollowup(
  screenshot: VisionInput,
  transcript: string,
  previous: Verdict
): Promise<Verdict> {
  if (previous.mode === "scam_check") {
    // Re-run scam analysis with a "explain more" nudge.
    const system = loadPrompt("scam_prompt.txt") +
      "\n\nThe user was not satisfied. Be more specific: quote visible text and walk through why it is or isn't safe.";
    const text = await callGemini(ANALYZE_MODEL, system, screenshot, `User said: "${transcript}". Give a deeper second look.`, 0);
    return parseScamVerdict(text);
  }
  if (previous.mode === "read_explain") {
    const system = loadPrompt("read_prompt.txt") +
      "\n\nThe user wants more detail. Expand the bullets and read_aloud, but keep language simple.";
    const text = await callGemini(ANALYZE_MODEL, system, screenshot, `User said: "${transcript}". Go into more detail.`, 0);
    return parseReadVerdict(text);
  }
  // help_click / walkthrough
  const prev = previous as ClickVerdict;
  const template = loadPrompt("followup_prompt.txt");
  const system = template
    .replace("{{PREVIOUS_TARGET}}", prev.target_description.replace(/"/g, "'"))
    .replace("{{PREVIOUS_LABEL}}", (prev.target_label || "").replace(/"/g, "'"))
    .replace("{{PREVIOUS_EXPLANATION}}", prev.explanation.replace(/"/g, "'"))
    .replace("{{TRANSCRIPT}}", transcript.replace(/"/g, "'"));
  const text = await callGemini(
    ANALYZE_MODEL,
    system,
    screenshot,
    `Original question: "${transcript}". Pick a different target.`,
    0
  );
  return parseClickVerdict(text, prev.mode);
}
