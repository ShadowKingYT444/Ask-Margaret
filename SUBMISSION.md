# Ask Margaret — Hackathon Submission

## Elevator Pitch

> One big button on grandma's screen. She presses it, asks out loud "where do I send this email?", and Margaret draws a circle around the Send button and reads the answer back to her.

*(197 characters)*

---

## About the Project

### Inspiration

Every holiday visit ends the same way: "honey, can you come look at my computer?" My grandmother is sharp, curious, and capable — but modern interfaces assume you already know what a hamburger menu is, which icon is the "three little dots", and that "tap the blue pill button" is a sentence that means something.

Tech support phone calls don't scale. Teaching someone to screenshot-and-text-me doesn't scale. What *does* scale is putting a patient, always-available helper **on the screen itself**, one that can see what she sees and speak back in plain English.

That's Margaret. One button. No menus. No jargon. No "click the hamburger icon."

### What I Learned

- **Multimodal models are ready for accessibility.** A single Gemini 2.5 Flash call can look at a 4K screenshot, listen to a raw voice clip, and return structured JSON telling you *what to circle and what to say*. Two years ago this would have been three services, a message queue, and a weekend of glue code.
- **"Thinking" tokens are silent killers.** Gemini 2.5 Flash burned my entire `maxOutputTokens: 500` budget on hidden reasoning and returned `""`. The only tell was `thoughtsTokenCount: 892` buried in the raw response. Setting `thinkingConfig: { thinkingBudget: 0 }` was the single-line fix that unblocked the whole pipeline.
- **Native dependencies are the enemy of accessibility installers.** `nodejs-whisper` required `cmake`, a C++ toolchain, and a 150 MB model download on first run. For a 78-year-old end user, any of those failing means the app is dead. Swapping Whisper for Gemini's audio input turned the installer from "probably broken on half of laptops" to "double-click, done."
- **Seniors need their defaults to be invisible.** The first prototype was a 200 × 200 pixel button stapled to the bottom-right of the screen. Grandma's reaction: *"it's in the way."* Final version: a draggable 100 × 100 dot with a 22 px close button that remembers where she put it. Invisible when ignored, obvious when needed.

### How I Built It

**Architecture in one picture:**

```
┌──────────────┐   press & speak    ┌──────────────┐
│  Button Win  │ ─────────────────► │   Main       │
│  (Electron)  │                    │   Process    │
└──────────────┘                    │              │
                                    │  1. capture  │
                                    │     screen   │
                                    │  2. webm→wav │
                                    │     (ffmpeg) │
                                    │  3. Gemini   │
                                    │     audio    │
                                    │     → text   │
                                    │  4. Gemini   │
                                    │     vision   │
                                    │     → JSON   │
                                    └──────┬───────┘
                                           │ verdict
                                           ▼
                                    ┌──────────────┐
                                    │ Result Win   │
                                    │  • screenshot│
                                    │  • ellipse   │
                                    │    overlay   │
                                    │  • TTS voice │
                                    └──────────────┘
```

**Pipeline (one button press):**

1. **Record.** `MediaRecorder` captures mic audio; `AudioContext` computes an RMS window — when RMS stays below a threshold for 1.8 s, recording auto-stops. No "press to stop" for grandma to forget.
2. **Capture.** `desktopCapturer` grabs the primary display as PNG, after hiding the Margaret window so it doesn't appear in its own screenshot.
3. **Transcribe.** `ffmpeg-static` converts the WebM/Opus clip to 16 kHz mono WAV; the WAV is sent to `gemini-2.5-flash` as `inlineData` with prompt *"Transcribe this audio exactly as spoken."*
4. **Analyze.** Screenshot + transcript go to a second Gemini call with a system prompt constrained to return JSON of the form:

   ```json
   {
     "explanation": "…",
     "target_description": "…",
     "target_region": "bottom-right",
     "target_box": { "x": 0-1000, "y": 0-1000, "w": 0-1000, "h": 0-1000 },
     "confidence": "high" | "medium" | "low"
   }
   ```

   The coordinates are normalized to a $1000 \times 1000$ grid so they're screen-resolution independent. The renderer maps them to pixels via

   $$
   (p_x, p_y) = \left(\frac{x}{1000} \cdot W_{\text{screen}},\; \frac{y}{1000} \cdot H_{\text{screen}}\right)
   $$

5. **Render.** A `<canvas>` draws the screenshot, then an ellipse overlay at $(p_x, p_y)$ with size $(p_w, p_h)$ using `ctx.ellipse(...)` with a warm drop-shadowed stroke.
6. **Speak.** `speechSynthesis.speak(new SpeechSynthesisUtterance(verdict.explanation))` reads the answer aloud.
7. **Follow up.** A "Show me again" button re-runs Gemini with a follow-up prompt that includes the previous verdict and a hint to try a different target, so repeated presses aren't just identical responses.

**Packaging:**

- `electron-builder` + NSIS with `oneClick: true`, `perMachine: false`, `createDesktopShortcut: "always"`, `runAfterFinish: true`. No UAC prompt, no install directory picker, no wizard at all — double-click installer, seconds later the button appears. Designed for seniors to install themselves with no help.
- `.env` holding the Gemini API key is shipped via `extraResources`; `main.ts` also checks `app.getPath("userData")/.env` so the end-user can override without touching installation files.
- Window position is persisted to `%AppData%/Ask Margaret/button-position.json` and clamped to the current work area on load, so the button never gets "stuck" offscreen when she switches monitors.

### Challenges I Ran Into

| Challenge | Root cause | Resolution |
|---|---|---|
| Button press transcribed audio, then silently hung | Gemini 2.5 Flash consumed the entire output budget on internal thinking tokens | `thinkingConfig: { thinkingBudget: 0 }` + bumped `maxOutputTokens` to 1200 |
| Installer failed on first run with a cryptic cmake error | `nodejs-whisper` compiles `whisper.cpp` at runtime and needs a C++ toolchain | Replaced Whisper entirely with Gemini audio — zero native deps |
| Follow-up calls returned malformed JSON (`contained_elements`, `next_action` keys) | Follow-up prompt drifted from the base schema | Rewrote follow-up prompt to restate the full schema; added defensive `parseVerdict` with region whitelist + coordinate clamping |
| Packaged app couldn't find `ffmpeg.exe` | `ffmpeg-static` resolves a path inside `app.asar`, but asar archives aren't executable | Added `asarUnpack` rule and a runtime `replace("app.asar", "app.asar.unpacked")` patch |
| First prototype was a 200×200 permanent eyesore | No drag support, no close, fixed corner | Shrunk to 100×100, made the frameless window draggable via `-webkit-app-region: drag`, added a 22 px × close button, persisted position across launches |

---

## Built With

**Languages**
- TypeScript (Electron main + preload)
- JavaScript (renderer processes)
- PowerShell (build helpers: icon generation, screenshot capture, TTS test audio)

**Runtime & Framework**
- Electron 32 (BrowserWindow, ipcMain, desktopCapturer, session permissions)
- Node.js 22

**AI / APIs**
- Google Gemini 2.5 Flash (`@google/genai` v1.50.1) — used twice per press: once for audio transcription, once for screenshot + intent analysis
- Web Speech API (`speechSynthesis`) for voice output

**Media & Capture**
- MediaRecorder API (WebM/Opus mic capture)
- Web Audio API (`AudioContext`, `AnalyserNode`) for RMS silence detection
- `ffmpeg-static` (bundled FFmpeg binary) for WebM → WAV conversion
- Canvas 2D API for annotated screenshot overlays

**Packaging & Distribution**
- `electron-builder` 25 with NSIS target (one-click silent installer)
- `dotenv` for configuration, shipped via `extraResources`

**Tooling**
- TypeScript 5.6 compiler
- `@types/node`
- PowerShell `System.Drawing` for icon generation
- PowerShell `System.Speech` for test audio fixtures

---

## Demo Script (2 minutes)

**0:00 – 0:15 — The problem**
> "My grandmother is 78. Every time she wants to send a text, she calls me. She doesn't need a new computer — she needs someone next to her pointing at the screen. This is Margaret."

*(Screen: Gmail inbox open, Margaret's small blue button floating in the corner.)*

**0:15 – 0:25 — The interaction**
> "There's one button. That's the whole app."

*(Press the blue button — it turns red and pulses.)*

> "I just talk to it."

*(Speak into mic: **"Where do I press to write a new email?"**)*

**0:25 – 0:45 — The magic**

*(Button turns orange: "Thinking…". Large result window pops up.)*

> "Margaret took a screenshot, heard my question, and figured out where to look. She drew a circle around the Compose button — and listen —"

*(TTS plays aloud: **"Sure! To write a new email, press the big red button on the left that says 'Compose'. That's where a new message starts."**)*

**0:45 – 1:05 — Follow-up**
> "If I still don't see it, I press 'Show me again' and Margaret tries a different target."

*(Click "Show me again" — overlay re-renders pointing at the same button from a different angle, e.g., the "+" icon on mobile view. TTS plays the new explanation.)*

**1:05 – 1:25 — It stays out of the way**
> "The button is small, always on top, and draggable. Grandma drops it wherever she wants."

*(Drag the floating button across the screen, then close it with the × corner button. Relaunch from desktop shortcut — it reappears exactly where she left it.)*

**1:25 – 1:45 — Built for actual seniors**
> "There's no sign-in. No menus. No settings. You install it with a double-click — no admin password, no wizard — and there's a big desktop shortcut that says 'Ask Margaret'."

*(Show the `Ask-Margaret-Setup-0.1.0.exe` installer. Double-click. Seconds later app launches.)*

**1:45 – 2:00 — The stack, in one breath**
> "Under the hood: one Electron window, FFmpeg to shape the audio, and Gemini 2.5 Flash doing both the speech-to-text and the vision reasoning in one trip. One button. One AI. One less phone call on Sundays."

*(End on the button pulsing gently on an empty desktop.)*

---

## Quick Install

```
double-click  →  Ask-Margaret-Setup-0.1.0.exe
```

That's it. Desktop shortcut created, app launches, button appears.
