# Ask Margaret

One-button desktop helper for seniors. They press the floating button, speak their question, and get back an annotated screenshot of their own screen with a circle around what to look at next — read aloud in a friendly voice.

- **Stack:** Electron + TypeScript, local Whisper (`nodejs-whisper`), Google Gemini 2.5 Flash for vision, Web Speech API for TTS.
- **Cost:** $0. Only network call is to Gemini (free tier).
- **Privacy:** Voice never leaves the machine. Only the screenshot + transcript are sent to Gemini.

## Setup (first run)

1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Add your Gemini API key** — copy `.env.example` to `.env` and paste your key:
   ```
   GEMINI_API_KEY=...
   ```
   Get a free key at https://aistudio.google.com/apikey.
3. **Pre-download the Whisper model** (so the first real use isn't slow):
   ```bash
   npm run download-model
   ```
   Pick `base.en` at the prompt (~150 MB).
4. **Run the app**
   ```bash
   npm start
   ```

### macOS extra step
Grant **Screen Recording** permission:
System Settings → Privacy & Security → Screen Recording → enable your Electron / terminal app. Without this, screenshots are all black.

## How it works

- A small always-on-top circular button sits in the bottom-right corner.
- Press it → it pulses red and listens. Auto-stops after ~2 seconds of silence, or press again to stop.
- The app hides the button, screenshots the screen, transcribes your question locally with Whisper, and sends (screenshot + transcript) to Gemini 2.5 Flash.
- A big result window opens showing your screenshot with a yellow circle drawn on what to look at, plus a plain-English explanation read aloud.
- Buttons: **Got it, thanks** / **Show me again** / **I still don't see it** (triggers a second pass).

## Project layout

```
ask-margaret/
├── src/
│   ├── main.ts              # Electron main: windows, IPC, screen capture
│   ├── preload.ts           # contextBridge API exposed to the renderer
│   ├── ai/
│   │   ├── transcribe.ts    # webm -> wav (ffmpeg-static) -> nodejs-whisper
│   │   └── analyze.ts       # Gemini 2.5 Flash vision call
│   └── prompts/
│       ├── analyze_prompt.txt
│       └── followup_prompt.txt
├── renderer/
│   ├── button/              # floating "I need help" window
│   └── result/              # annotated screenshot + TTS window
├── scripts/copy-assets.js   # copies prompts into dist/
└── .env.example
```

## Scripts

| Command | What it does |
|---|---|
| `npm run build` | TypeScript compile + copy prompt assets into `dist/` |
| `npm start` | Build and launch Electron |
| `npm run dev` | Same as start, with `--enable-logging` |
| `npm run download-model` | Pre-download Whisper `base.en` model |
| `npm run package` | Build a distributable with electron-builder |

## Known footguns

- **macOS screen recording permission** — first capture returns a black image until you grant permission, then restart.
- **Web Speech API voices load asynchronously** — we wait for `onvoiceschanged` before picking one.
- **Gemini occasionally wraps JSON in markdown fences** — we set `responseMimeType: "application/json"` and also strip fences defensively.
- **Always-on-top on Linux** varies by desktop environment. Demo on macOS or Windows.
