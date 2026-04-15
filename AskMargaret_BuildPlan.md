# Ask Margaret — Build Plan (Free Stack)

## One-Line Pitch
A desktop helper for seniors with one giant button: "I need help." They speak their question naturally, the AI looks at their screen, and answers in plain language with a circle drawn directly on top of what they should click next — read aloud in a friendly voice.

## Target User
A 78-year-old at home or at the senior center computer lab. They're stuck on something — a confusing pop-up, an email they can't send, a form they can't submit. There's nobody to ask. They would normally give up and turn the computer off.

## Core Principles (Do Not Violate)
1. **One button.** The whole interface is one button labeled "I need help." That's it.
2. **Voice first.** Seniors describe their problem out loud, like talking to a person. No typing required, ever.
3. **Show, don't tell.** The answer is a screenshot of *their actual screen* with a circle drawn on what to look at next, plus a short voice explanation.
4. **Patience.** Never use words like "click," "icon," "browser," or "tab" without context. Say "the blue button on the right" or "the picture of a house at the top."
5. **No setup, no accounts, no internet for the audio.** Speech recognition runs locally on the computer. Only the screenshot + transcript ever leave the machine (sent to Gemini).

## Feature Scope (Hackathon MVP)

### Must-have
1. **Floating "I need help" button** — Always-on-top window with one giant button.
2. **Voice capture** — Press button → starts recording. Press again or auto-stop on silence.
3. **Screenshot capture** — When the user starts speaking, capture the active screen behind the floating window.
4. **Local speech-to-text** — Whisper running locally via `nodejs-whisper`. No API call, no key.
5. **AI analysis** — Send (screenshot + voice transcript) to Gemini 2.5 Flash with vision. Get back: explanation + coordinates of what to point at.
6. **Annotated overlay** — Show the screenshot back to the user with a bright circle drawn at the AI's coordinates, plus the explanation in huge text.
7. **Voice answer** — Read the explanation aloud using the built-in Web Speech API (uses the OS voices, free, zero install).
8. **"Show me again" button** — Replays the explanation. Seniors will need this constantly.

### Nice-to-have
9. **Follow-up questions** — "Where is that?" / "I don't see it." → second pass.
10. **History** — Last 5 questions, retrievable.

### Out of scope
- Multi-user accounts, cloud sync, mobile version, automation/scripting actions on the user's behalf (don't actually click for them — the goal is teaching).

## User Flow

1. Senior is stuck on Gmail, can't figure out how to attach a photo.
2. Floating "I need help" button is on the screen (always on top, bottom-right corner).
3. They press it. The button turns red and pulses: "I'm listening."
4. They say: "I want to send a picture to my daughter but I don't know how."
5. The app captures the current screen, runs Whisper locally on the audio, sends screen + transcript to Gemini.
6. Within ~6 seconds, a large window appears showing their Gmail screen with a bright yellow circle around the paperclip icon, and the text:
   > "To attach a picture, click the paperclip at the bottom of the message — I drew a circle around it."
7. A friendly voice reads this aloud (using built-in OS TTS).
8. Big buttons at the bottom: **"Got it, thanks"** / **"Show me again"** / **"I still don't see it"**

## Build Milestones

| # | Milestone | Done when |
|---|---|---|
| 1 | Electron app shell with floating always-on-top window | A button on screen does nothing, but stays on top of all windows |
| 2 | Voice recording on button press | Press button, speak, get a wav saved locally |
| 3 | `nodejs-whisper` integrated | Recording → text transcript (offline) |
| 4 | Screenshot capture of full screen (not the floating button itself) | A PNG of the user's actual screen is saved when they press the button |
| 5 | Gemini vision call with screenshot + transcript | Console logs a JSON response with explanation + coordinates |
| 6 | Result overlay window with annotated screenshot | Big window shows screenshot + circle drawn at right spot + text |
| 7 | Web Speech API reads explanation aloud | You can hear the answer |
| 8 | "Show again" / "I still don't see it" buttons | Follow-up loop works |
| 9 | Polish: pulse animation, big fonts, packaging | Demo-ready |

## Demo Script (3 minutes)
1. **Hook (20s)** — "Seniors don't fail at technology because it's hard. They fail because there's nobody to ask. We built the patient grandkid that's always available."
2. **Live demo (90s)** — Open Gmail on the demo laptop. Press the button. Say out loud: "How do I attach a picture to this email?" Wait. Watch the annotated screen pop up with a circle on the paperclip. Let the voice read it.
3. **Second demo (40s)** — Switch to a confusing Windows pop-up. Press the button: "What is this thing asking me?" Show how it explains in plain English.
4. **Why it works for GenLink (30s)** — "This installs on every computer in every senior center lab. One button. No training. No subscription. Speech recognition runs offline so seniors' voices never leave the computer."

## Key Risks & Mitigations
- **Screenshot privacy.** The senior's screen may have personal info. Mitigation: process locally where possible, never store screenshots after the session, show a "what we sent" confirmation in settings. Voice never leaves the machine (Whisper is local).
- **Wrong coordinates from the AI.** Vision models hallucinate pixel coordinates. Mitigation: ask the model to describe the target in words AND give a rough region (top-right, center, etc.). Draw a large circle, not a precise dot. If totally wrong, the "I still don't see it" button triggers a second pass with the model told it was wrong.
- **`nodejs-whisper` first-run download.** The model downloads on first use (~150MB for `base.en`). Mitigation: pre-download the model during install/setup, before the demo.
- **Web Speech API voice quality varies by OS.** macOS voices are great, Windows voices are okay, Linux voices are rough. Mitigation: pick the best available voice on startup. Demo on macOS or Windows for best impression.
- **The "always on top" floating window is annoying when not needed.** Mitigation: make it small and semi-transparent when idle, expand on hover.

## Test Scenarios (build before demo)
1. Gmail: "How do I send a picture?"
2. A web pop-up: "What is this asking?"
3. Word/Google Docs: "How do I make this bigger?"
4. Zoom: "Where is the mute button?"
5. A scam-looking pop-up: "Is this safe?" (bonus: integrates conceptually with SafeCheck)
6. Settings page: "How do I make the text bigger?"
