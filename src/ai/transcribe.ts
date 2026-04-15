import { GoogleGenAI } from "@google/genai";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawn } from "child_process";
import ffmpegStatic from "ffmpeg-static";

const FFMPEG_BIN: string | null = (() => {
  const raw = ffmpegStatic as unknown as string | null;
  if (!raw) return null;
  // In packaged app, ffmpeg-static binary lives inside app.asar.unpacked.
  return raw.replace("app.asar", "app.asar.unpacked");
})();

function convertWebmToWav(webmPath: string, wavPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!FFMPEG_BIN) {
      reject(new Error("ffmpeg-static binary not found."));
      return;
    }
    const proc = spawn(FFMPEG_BIN, [
      "-y",
      "-i",
      webmPath,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      wavPath,
    ]);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed (${code}): ${stderr}`));
    });
  });
}

function getClient(): GoogleGenAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set.");
  return new GoogleGenAI({ apiKey: key });
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

export async function transcribe(audioBuffer: Buffer): Promise<string> {
  const stamp = Date.now();
  const tmpDir = os.tmpdir();
  const webmPath = path.join(tmpDir, `margaret-${stamp}.webm`);
  const wavPath = path.join(tmpDir, `margaret-${stamp}.wav`);

  fs.writeFileSync(webmPath, audioBuffer);
  console.log(`[transcribe] wrote webm ${webmPath} (${audioBuffer.length}B)`);

  try {
    await convertWebmToWav(webmPath, wavPath);
    const wavSize = fs.existsSync(wavPath) ? fs.statSync(wavPath).size : 0;
    console.log(`[transcribe] wav=${wavPath} (${wavSize}B)`);
    if (wavSize < 1000) {
      throw new Error(`ffmpeg produced empty/tiny wav (${wavSize}B). Check microphone.`);
    }

    const wavBytes = fs.readFileSync(wavPath);
    const ai = getClient();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: "audio/wav", data: wavBytes.toString("base64") } },
            {
              text:
                "Transcribe this audio exactly as spoken. Return ONLY the spoken words, " +
                "no quotes, no punctuation commentary, no 'the user said'. If you hear nothing, return an empty string.",
            },
          ],
        },
      ],
      config: {
        temperature: 0,
        maxOutputTokens: 512,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const text = extractText(response).trim();
    console.log(`[transcribe] gemini transcript ${text.length} chars: ${JSON.stringify(text).slice(0, 160)}`);
    return text;
  } finally {
    for (const p of [webmPath, wavPath]) {
      if (fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch {
          // best-effort cleanup
        }
      }
    }
  }
}
