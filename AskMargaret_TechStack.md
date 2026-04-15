# Ask Margaret — Tech Stack & Implementation Spec (Free Stack)

## Stack Summary
| Layer | Choice | Cost |
|---|---|---|
| App shell | **Electron** (latest) | Free |
| Language | **TypeScript + Node** (main) + **vanilla HTML/CSS/JS** (renderer) | Free |
| Screen capture | **Electron `desktopCapturer` API** | Built in |
| Voice capture | **Browser `MediaRecorder` API** in renderer | Built in |
| Speech-to-text | **`nodejs-whisper`** (whisper.cpp bindings, runs locally) | Free, offline |
| Vision + reasoning | **Google Gemini 2.5 Flash** via `@google/genai` SDK | Free tier |
| Text-to-speech | **Web Speech API `speechSynthesis`** in renderer (uses OS voices) | Free, built in |
| Annotation drawing | **HTML Canvas** in the result window | Built in |
| Packaging | **electron-builder** | Free |

**Total cost: $0. Only network call is to Gemini.** Voice never leaves the machine.

## File Structure
```
ask-margaret/
├── README.md
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── main.ts                # Electron main process: windows, IPC, screen capture
│   ├── preload.ts             # Bridge between main and renderer
│   ├── ai/
│   │   ├── transcribe.ts      # nodejs-whisper local STT
│   │   └── analyze.ts         # Gemini vision API call
│   └── prompts/
│       └── analyze_prompt.txt # System prompt for Gemini
├── renderer/
│   ├── button/
│   │   ├── index.html         # Floating "I need help" button
│   │   ├── button.css
│   │   └── button.js
│   └── result/
│       ├── index.html         # Annotated screenshot window
│       ├── result.css
│       └── result.js
├── models/
│   └── ggml-base.en.bin       # Whisper model (~150MB, downloaded on first run)
├── assets/
│   └── icon.png
└── test_screens/
    └── *.png                  # Sample screenshots for offline dev
```

## package.json
```json
{
  "name": "ask-margaret",
  "version": "0.1.0",
  "main": "dist/main.js",
  "scripts": {
    "build": "tsc",
    "start": "npm run build && electron .",
    "package": "electron-builder"
  },
  "dependencies": {
    "@google/genai": "^0.3.0",
    "dotenv": "^16.4.5",
    "nodejs-whisper": "^0.2.4"
  },
  "devDependencies": {
    "electron": "^32.0.0",
    "electron-builder": "^25.0.0",
    "typescript": "^5.6.0",
    "@types/node": "^22.0.0"
  }
}
```

## .env.example
```
GEMINI_API_KEY=your_gemini_key_here
```

## Architecture (Two Windows + Background)
```
┌──────────────────────┐         ┌─────────────────────────┐
│  Floating Button     │  IPC    │   Main Process          │
│  (always on top)     │ ──────► │   - desktopCapturer     │
│  small, pulsing      │         │   - nodejs-whisper      │
└──────────────────────┘         │   - Gemini call         │
         ▲                       └────────────┬────────────┘
         │                                    │ IPC
         │                                    ▼
         │                       ┌─────────────────────────┐
         └──── reopen on close ──│  Result Window          │
                                 │  - shows screenshot     │
                                 │  - draws circle         │
                                 │  - speechSynthesis      │
                                 │  - "show again" buttons │
                                 └─────────────────────────┘
```

## The Core Prompt (src/prompts/analyze_prompt.txt)
```
You are Margaret, a kind and patient computer helper for senior citizens. You receive:
1. A screenshot of what is currently on the user's computer screen.
2. A transcript of the user asking for help, in their own words.

Your job: figure out what they're trying to do, find the thing on screen they should interact with next, and explain it like you're talking to your 78-year-old grandmother who has never used a computer.

Return ONLY valid JSON in exactly this shape:
{
  "explanation": "<2-3 short sentences in plain English. Read aloud, max 40 words. No jargon.>",
  "target_description": "<words describing the thing to look at: 'the blue Send button at the bottom right'>",
  "target_region": "top-left" | "top-center" | "top-right" | "middle-left" | "center" | "middle-right" | "bottom-left" | "bottom-center" | "bottom-right",
  "target_box": { "x": <0-1000>, "y": <0-1000>, "w": <0-1000>, "h": <0-1000> },
  "confidence": "high" | "medium" | "low"
}

Coordinate system: the screenshot is normalized to 1000x1000. Give the bounding box of the thing to highlight in those coordinates.

Rules:
- NEVER use the words "click", "icon", "browser", "tab", "menu", "interface", "URL", "cursor". Use "press", "the picture of", "the box that says", "the place where it says".
- Always describe the target by what it LOOKS like, not what it's called.
- If you're not sure where the thing is, set confidence to "low" and pick the most likely region.
- If the user's question can't be answered from this screen (they need to navigate elsewhere), explain the first step only.
- Keep explanations warm. Start with "Sure!" or "Of course!" or "No problem!" sometimes.

Return ONLY the JSON. Nothing else. No markdown fences.
```

## Main Process (src/main.ts)
```typescript
import { app, BrowserWindow, ipcMain, desktopCapturer, screen } from "electron";
import * as path from "path";
import * as dotenv from "dotenv";
import { transcribe } from "./ai/transcribe";
import { analyze } from "./ai/analyze";

dotenv.config();

let buttonWin: BrowserWindow;
let resultWin: BrowserWindow | null = null;

function createButtonWindow() {
  buttonWin = new BrowserWindow({
    width: 180, height: 180,
    frame: false, transparent: true, alwaysOnTop: true, resizable: false,
    skipTaskbar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  buttonWin.loadFile("renderer/button/index.html");
  buttonWin.setAlwaysOnTop(true, "screen-saver");
}

ipcMain.handle("capture-screen", async () => {
  buttonWin.hide();
  await new Promise(r => setTimeout(r, 100));
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: screen.getPrimaryDisplay().size,
  });
  buttonWin.show();
  return sources[0].thumbnail.toPNG(); // Buffer
});

ipcMain.handle("ask-margaret", async (_e, payload: { audioBuffer: Buffer; screenshotBuffer: Buffer }) => {
  const transcript = await transcribe(payload.audioBuffer);
  const verdict = await analyze(payload.screenshotBuffer, transcript);
  openResultWindow({ screenshotBuffer: payload.screenshotBuffer, verdict, transcript });
});

function openResultWindow(payload: any) {
  if (resultWin) { resultWin.close(); resultWin = null; }
  resultWin = new BrowserWindow({
    width: 1100, height: 800,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  resultWin.loadFile("renderer/result/index.html");
  resultWin.webContents.on("did-finish-load", () => {
    resultWin!.webContents.send("show-result", {
      screenshotBase64: payload.screenshotBuffer.toString("base64"),
      verdict: payload.verdict,
      transcript: payload.transcript,
    });
  });
}

app.whenReady().then(createButtonWindow);
```

## STT Layer (src/ai/transcribe.ts)
```typescript
import { nodewhisper } from "nodejs-whisper";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Run once at install: this downloads ggml-base.en.bin to node_modules/nodejs-whisper/cpp/whisper.cpp/models
// You can also pre-download manually with: npx nodejs-whisper download

export async function transcribe(audioBuffer: Buffer): Promise<string> {
  const tmp = path.join(os.tmpdir(), `margaret-${Date.now()}.wav`);
  fs.writeFileSync(tmp, audioBuffer);
  try {
    const result = await nodewhisper(tmp, {
      modelName: "base.en",
      autoDownloadModelName: "base.en",
      removeWavFileAfterTranscription: true,
      withCuda: false,
      whisperOptions: {
        outputInText: true,
        language: "en",
        wordTimestamps: false,
      },
    });
    return (result || "").trim();
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}
```

**Important note about audio format:** `MediaRecorder` in Electron typically gives you `webm/opus`. `nodejs-whisper` wants WAV. Easiest fix: in the renderer, record with `MediaRecorder({ mimeType: "audio/webm" })`, then in main process convert to WAV using `ffmpeg` (bundle the static binary via the `ffmpeg-static` package — it's MIT licensed and free). Add `ffmpeg-static` to dependencies and convert before passing to whisper.

## Vision Layer (src/ai/analyze.ts)
```typescript
import { GoogleGenAI } from "@google/genai";
import * as fs from "fs";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const SYSTEM = fs.readFileSync("src/prompts/analyze_prompt.txt", "utf-8");

export async function analyze(screenshot: Buffer, transcript: string): Promise<any> {
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
      systemInstruction: SYSTEM,
      responseMimeType: "application/json",
      temperature: 0.3,
      maxOutputTokens: 500,
    },
  });
  return JSON.parse(response.text);
}
```

## Renderer: Button Window (renderer/button/button.js)
```javascript
let recording = false;
let mediaRecorder;
let chunks = [];

const btn = document.getElementById("btn");

btn.addEventListener("click", async () => {
  if (!recording) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    chunks = [];
    mediaRecorder.ondataavailable = e => chunks.push(e.data);
    mediaRecorder.onstop = async () => {
      const blob = new Blob(chunks, { type: "audio/webm" });
      const audioBuffer = Buffer.from(await blob.arrayBuffer());
      const screenshotBuffer = await window.api.captureScreen();
      btn.classList.remove("recording");
      btn.textContent = "Thinking...";
      await window.api.askMargaret({ audioBuffer, screenshotBuffer });
      btn.textContent = "I need help";
      stream.getTracks().forEach(t => t.stop());
    };
    mediaRecorder.start();
    btn.classList.add("recording");
    btn.textContent = "I'm listening...";
    recording = true;
  } else {
    mediaRecorder.stop();
    recording = false;
  }
});
```

## Renderer: Result Window (renderer/result/result.js)
```javascript
window.api.onShowResult(({ screenshotBase64, verdict }) => {
  const canvas = document.getElementById("screen");
  const ctx = canvas.getContext("2d");
  const img = new Image();
  img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    // Convert normalized 0-1000 to pixel coords
    const { x, y, w, h } = verdict.target_box;
    const px = (x / 1000) * img.width;
    const py = (y / 1000) * img.height;
    const pw = (w / 1000) * img.width;
    const ph = (h / 1000) * img.height;

    // Fat yellow circle
    ctx.strokeStyle = "rgba(255, 215, 0, 0.95)";
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.ellipse(px + pw/2, py + ph/2, pw*0.7 + 30, ph*0.7 + 30, 0, 0, 2*Math.PI);
    ctx.stroke();
  };
  img.src = "data:image/png;base64," + screenshotBase64;

  document.getElementById("explanation").textContent = verdict.explanation;
  speak(verdict.explanation);
});

function speak(text) {
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.95;
  u.pitch = 1.0;
  // Pick a friendly voice if available
  const voices = speechSynthesis.getVoices();
  const preferred = voices.find(v => /samantha|zira|female/i.test(v.name)) || voices[0];
  if (preferred) u.voice = preferred;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

document.getElementById("again").addEventListener("click", () => {
  speak(document.getElementById("explanation").textContent);
});
```

## preload.ts
```typescript
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  captureScreen: () => ipcRenderer.invoke("capture-screen"),
  askMargaret: (payload: any) => ipcRenderer.invoke("ask-margaret", payload),
  onShowResult: (cb: (data: any) => void) => ipcRenderer.on("show-result", (_e, data) => cb(data)),
});
```

## First-Run Setup
1. `npm install`
2. `npx nodejs-whisper download` and select `base.en` — this caches the ~150MB model so the first real use isn't slow.
3. Copy `.env.example` to `.env`, paste your Gemini key.
4. `npm start`
5. **macOS only:** grant Screen Recording permission in System Settings → Privacy & Security → Screen Recording. Without this, screenshots will be all black.

## Performance Targets
- Button press → recording starts: < 200ms
- Speech end → answer on screen: < 7 seconds (1s screenshot + 2-3s local Whisper + 2-3s Gemini + buffer)
- Local Whisper on `base.en` runs at roughly 5-10x realtime on a modern CPU. A 5-second question transcribes in ~1 second.
