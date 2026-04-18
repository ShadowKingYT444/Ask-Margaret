# Ask Margaret

One-button desktop helper for seniors. They press the floating button, speak their question, and get back an annotated screenshot of their own screen with a circle around what to look at next, read aloud in a friendly voice.

- **Stack:** Electron + TypeScript, `ffmpeg-static` for audio conversion, Google Gemini 2.5 for transcription and vision, Web Speech API for TTS.
- **Cost:** Uses Gemini API calls for transcription and analysis.
- **Privacy:** The screenshot and transcribed request are sent to Gemini.

## Setup (first run)

1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Run the app**
   ```bash
   npm start
   ```
3. **Paste your Gemini API key on first launch**
   Get a key at https://aistudio.google.com/apikey. The app stores it in its user data folder after you save it.

### macOS extra step
Grant **Screen Recording** permission:
System Settings → Privacy & Security → Screen Recording → enable your Electron / terminal app. Without this, screenshots are all black.

## How it works

- A small always-on-top circular button sits in the bottom-right corner.
- Press it → it pulses red and listens. Auto-stops after ~2 seconds of silence, or press again to stop.
- The app hides the button, screenshots the current display, transcribes your question, and sends the screenshot plus transcript to Gemini.
- A big result window opens showing your screenshot with a yellow circle drawn on what to look at, plus a plain-English explanation read aloud.
- Buttons: **Got it, thanks** / **Show me again** / **I still don't see it** (triggers a second pass).

## Project layout

```
ask-margaret/
├── src/
│   ├── main.ts              # Electron main: windows, IPC, screen capture
│   ├── preload.ts           # contextBridge API exposed to the renderer
│   ├── ai/
│   │   ├── transcribe.ts    # webm -> wav (ffmpeg-static) -> Gemini transcription
│   │   ├── analyze.ts       # Gemini vision/router calls
│   │   └── chat.ts          # follow-up voice chat in the result window
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
| `npm run package` | Build a distributable with electron-builder |
| `npm run package:win:ci` | Build the Windows installer in CI without auto-publishing from electron-builder |

## Known footguns

- **macOS screen recording permission** — first capture returns a black image until you grant permission, then restart.
- **Web Speech API voices load asynchronously** — we wait for `onvoiceschanged` before picking one.
- **Gemini occasionally wraps JSON in markdown fences** — we set `responseMimeType: "application/json"` and also strip fences defensively.
- **Always-on-top on Linux** varies by desktop environment. Demo on macOS or Windows.
