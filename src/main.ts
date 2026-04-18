import { app, BrowserWindow, ipcMain, desktopCapturer, screen, session, shell } from "electron";
import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";
import { transcribe } from "./ai/transcribe";
import { analyze, analyzeFollowup, Verdict } from "./ai/analyze";
import { chat, ChatTurn } from "./ai/chat";

// Reset any inherited key: we only trust the one stored under userData after setup.
// Otherwise Windows user env vars or a project .env silently bypass the setup flow.
delete process.env.GEMINI_API_KEY;

let buttonWin: BrowserWindow | null = null;
let resultWin: BrowserWindow | null = null;
let setupWin: BrowserWindow | null = null;

function userEnvPath(): string {
  return path.join(app.getPath("userData"), ".env");
}

function hasApiKey(): boolean {
  const p = userEnvPath();
  if (!fs.existsSync(p)) return false;
  try {
    const parsed = dotenv.parse(fs.readFileSync(p));
    if (parsed.GEMINI_API_KEY && parsed.GEMINI_API_KEY.trim().length > 0) {
      process.env.GEMINI_API_KEY = parsed.GEMINI_API_KEY;
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

function createSetupWindow(): void {
  setupWin = new BrowserWindow({
    width: 640,
    height: 640,
    title: "Ask Margaret - Setup",
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  setupWin.setMenuBarVisibility(false);
  setupWin.loadFile(rendererPath("setup", "index.html"));
  setupWin.on("closed", () => {
    setupWin = null;
    if (!hasApiKey()) app.quit();
  });
}

// Cache of last interaction for follow-up passes.
let lastContext: {
  screenshotBuffer: Buffer;
  transcript: string;
  verdict: Verdict;
} | null = null;

function rendererPath(...segments: string[]): string {
  // renderer/ is not compiled — reference from project root at runtime.
  return path.join(__dirname, "..", "renderer", ...segments);
}

const BUTTON_W = 100;
const BUTTON_H = 100;

function positionFilePath(): string {
  return path.join(app.getPath("userData"), "button-position.json");
}

function loadSavedPosition(): { x: number; y: number } | null {
  try {
    const p = positionFilePath();
    if (!fs.existsSync(p)) return null;
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8"));
    if (typeof parsed.x === "number" && typeof parsed.y === "number") return parsed;
  } catch {
    // ignore
  }
  return null;
}

function savePosition(x: number, y: number): void {
  try {
    fs.writeFileSync(positionFilePath(), JSON.stringify({ x, y }));
  } catch {
    // best-effort
  }
}

function createButtonWindow(): void {
  buttonWin = new BrowserWindow({
    width: BUTTON_W,
    height: BUTTON_H,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  buttonWin.loadFile(rendererPath("button", "index.html"));
  buttonWin.setAlwaysOnTop(true, "screen-saver");
  if (process.env.MARGARET_DEBUG === "1") {
    buttonWin.webContents.openDevTools({ mode: "detach" });
  }

  const { workArea } = screen.getPrimaryDisplay();
  const saved = loadSavedPosition();
  const defaultX = workArea.x + workArea.width - BUTTON_W - 20;
  const defaultY = workArea.y + workArea.height - BUTTON_H - 20;
  const x = saved ? Math.max(workArea.x, Math.min(workArea.x + workArea.width - BUTTON_W, saved.x)) : defaultX;
  const y = saved ? Math.max(workArea.y, Math.min(workArea.y + workArea.height - BUTTON_H, saved.y)) : defaultY;
  buttonWin.setPosition(x, y);

  let saveTimer: NodeJS.Timeout | null = null;
  buttonWin.on("move", () => {
    if (!buttonWin || buttonWin.isDestroyed()) return;
    const [nx, ny] = buttonWin.getPosition();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => savePosition(nx, ny), 250);
  });
}

function openResultWindow(): void {
  if (resultWin && !resultWin.isDestroyed()) {
    resultWin.focus();
    return;
  }
  const { workArea } = screen.getPrimaryDisplay();
  resultWin = new BrowserWindow({
    width: workArea.width,
    height: workArea.height,
    x: workArea.x,
    y: workArea.y,
    minWidth: 900,
    minHeight: 700,
    title: "Ask Margaret",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  resultWin.setMenuBarVisibility(false);
  resultWin.once("ready-to-show", () => {
    if (resultWin && !resultWin.isDestroyed()) {
      resultWin.maximize();
      resultWin.show();
    }
  });
  // Belt-and-suspenders: renderer normally signals 'result-ready' once it
  // finishes setting up IPC listeners. If something in the renderer throws
  // before that point, the window would hang forever — so also send after
  // did-finish-load as a backup.
  resultWin.webContents.once("did-finish-load", () => {
    setTimeout(() => {
      if (resultWin && !resultWin.isDestroyed()) sendToResult();
    }, 400);
  });
  resultWin.loadFile(rendererPath("result", "index.html"));
  resultWin.on("closed", () => {
    resultWin = null;
  });
}

let resultSentForCurrentContext = false;

function sendToResult(): void {
  if (!lastContext || !resultWin || resultWin.isDestroyed()) return;
  if (resultSentForCurrentContext) return;
  resultSentForCurrentContext = true;
  resultWin.webContents.send("show-result", {
    screenshotBase64: lastContext.screenshotBuffer.toString("base64"),
    verdict: lastContext.verdict,
    transcript: lastContext.transcript,
  });
}

ipcMain.handle("capture-screen", async (): Promise<Buffer> => {
  if (buttonWin && !buttonWin.isDestroyed()) buttonWin.hide();
  // Small delay so the hide actually takes effect before capture.
  await new Promise((r) => setTimeout(r, 120));
  try {
    const primary = screen.getPrimaryDisplay();
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: {
        width: primary.size.width,
        height: primary.size.height,
      },
    });
    if (sources.length === 0) throw new Error("No screen sources returned by desktopCapturer.");
    return sources[0].thumbnail.toPNG();
  } finally {
    if (buttonWin && !buttonWin.isDestroyed()) buttonWin.show();
  }
});

ipcMain.handle(
  "ask-margaret",
  async (
    _e,
    payload: { audioBuffer: ArrayBuffer; screenshotBuffer: ArrayBuffer }
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const audio = Buffer.from(payload.audioBuffer);
      const screenshot = Buffer.from(payload.screenshotBuffer);
      console.log(
        `[margaret] received audio=${audio.length}B screenshot=${screenshot.length}B`
      );

      let transcript: string;
      try {
        transcript = await transcribe(audio);
      } catch (e: any) {
        const raw = e?.message || String(e);
        console.error("[margaret] transcribe error:", raw);
        throw new Error(raw);
      }
      console.log("[margaret] transcript:", JSON.stringify(transcript));

      if (!transcript || transcript.length < 2) {
        throw new Error("I didn't hear you. Please try again and speak clearly.");
      }

      let verdict;
      try {
        verdict = await analyze(screenshot, transcript);
      } catch (e: any) {
        const raw = e?.message || String(e);
        console.error("[margaret] analyze error:", raw);
        throw new Error("I couldn't reach Gemini. Check your internet and API key.");
      }
      console.log("[margaret] verdict:", verdict);

      lastContext = { screenshotBuffer: screenshot, transcript, verdict };
      resultSentForCurrentContext = false;
      openResultWindow();
      // Renderer signals 'result-ready' on did-finish-load; send then.
      return { ok: true };
    } catch (err: unknown) {
      const e = err as any;
      const msg = e?.stack || e?.message || String(err);
      console.error("[margaret] error:", msg);
      return { ok: false, error: e?.message || String(err) };
    }
  }
);

ipcMain.handle("result-ready", () => {
  sendToResult();
});

ipcMain.handle("try-again", async (): Promise<{ ok: boolean; error?: string }> => {
  if (!lastContext) return { ok: false, error: "No previous question to follow up on." };
  try {
    const verdict = await analyzeFollowup(
      lastContext.screenshotBuffer,
      lastContext.transcript,
      lastContext.verdict
    );
    lastContext = { ...lastContext, verdict };
    resultSentForCurrentContext = false;
    sendToResult();
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[margaret] follow-up error:", msg);
    return { ok: false, error: msg };
  }
});

ipcMain.handle(
  "chat-margaret",
  async (
    _e,
    payload: { audioBuffer: ArrayBuffer; history: ChatTurn[] }
  ): Promise<{ ok: boolean; answer?: string; transcribedQuestion?: string; error?: string }> => {
    try {
      const audio = Buffer.from(payload.audioBuffer);
      const screenshot = lastContext?.screenshotBuffer ?? null;
      const history = Array.isArray(payload.history) ? payload.history : [];
      const result = await chat(audio, screenshot, history);
      return { ok: true, answer: result.answer, transcribedQuestion: result.transcribedQuestion };
    } catch (err: unknown) {
      const e = err as any;
      const msg = e?.message || String(err);
      console.error("[chat] error:", msg);
      return { ok: false, error: msg };
    }
  }
);

ipcMain.handle("close-result", () => {
  if (resultWin && !resultWin.isDestroyed()) resultWin.close();
});

ipcMain.handle("quit-app", () => {
  app.quit();
});

ipcMain.handle("open-external", async (_e, url: string) => {
  if (typeof url === "string" && /^https?:\/\//i.test(url)) {
    await shell.openExternal(url);
  }
});

ipcMain.handle(
  "save-api-key",
  async (_e, key: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const trimmed = (key || "").trim();
      if (!trimmed) return { ok: false, error: "Key is empty." };
      const dir = app.getPath("userData");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const envPath = path.join(dir, ".env");
      fs.writeFileSync(envPath, `GEMINI_API_KEY=${trimmed}\n`, { encoding: "utf-8" });
      process.env.GEMINI_API_KEY = trimmed;
      setTimeout(() => {
        if (setupWin && !setupWin.isDestroyed()) {
          setupWin.removeAllListeners("closed");
          setupWin.close();
          setupWin = null;
        }
        if (!buttonWin || buttonWin.isDestroyed()) createButtonWindow();
      }, 600);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  }
);

async function runTestHarness(): Promise<void> {
  const fs = await import("fs");
  const imgPath = path.join(__dirname, "..", "test_screens", "live.png");
  if (!fs.existsSync(imgPath)) {
    console.error(`[test-harness] missing ${imgPath}. Run scripts/screenshot.ps1 first.`);
    return;
  }
  const screenshot = fs.readFileSync(imgPath);
  const transcript =
    process.env.MARGARET_TEST_TRANSCRIPT ||
    "Where should I press to send a message right now?";
  console.log(`[test-harness] image=${imgPath} transcript=${JSON.stringify(transcript)}`);
  const verdict = await analyze(screenshot, transcript);
  console.log("[test-harness] verdict:", verdict);
  lastContext = { screenshotBuffer: screenshot, transcript, verdict };
  openResultWindow();
}

app.whenReady().then(() => {
  // Grant microphone + screen permission requests automatically inside our own app.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = new Set([
      "media",
      "microphone",
      "audioCapture",
      "display-capture",
      "videoCapture",
    ]);
    callback(allowed.has(permission as string));
  });
  // Electron 30+ requires this for getDisplayMedia; we still use desktopCapturer,
  // but some Electron builds on Windows route screen capture through it.
  if ((session.defaultSession as any).setDisplayMediaRequestHandler) {
    (session.defaultSession as any).setDisplayMediaRequestHandler(
      (_req: any, cb: any) => {
        desktopCapturer
          .getSources({ types: ["screen"] })
          .then((sources) => cb({ video: sources[0], audio: "loopback" }))
          .catch(() => cb({}));
      }
    );
  }

  const testMode =
    process.argv.includes("--test-harness") || process.env.MARGARET_TEST === "1";
  if (testMode) {
    runTestHarness().catch((e) => console.error("[test-harness] error:", e));
  } else if (hasApiKey()) {
    createButtonWindow();
  } else {
    createSetupWindow();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && !testMode) {
      if (hasApiKey()) createButtonWindow();
      else createSetupWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
