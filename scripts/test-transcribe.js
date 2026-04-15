// Standalone test: feed a wav into the Gemini transcribe path.
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
require("dotenv").config();

const ffmpeg = require("ffmpeg-static");

async function main() {
  const wav = path.join(__dirname, "..", "test_screens", "live.wav");
  if (!fs.existsSync(wav)) {
    console.error("missing test_screens/live.wav — run scripts/make-test-audio.ps1 first");
    process.exit(1);
  }
  // Convert wav -> webm to mimic what the renderer actually sends.
  const webm = path.join(__dirname, "..", "test_screens", "live.webm");
  const r = spawnSync(ffmpeg, ["-y", "-i", wav, "-c:a", "libopus", webm]);
  if (r.status !== 0) {
    console.error("ffmpeg wav->webm failed:", r.stderr.toString());
    process.exit(1);
  }
  const audio = fs.readFileSync(webm);
  console.log("webm bytes:", audio.length);

  const { transcribe } = require("../dist/ai/transcribe.js");
  const text = await transcribe(audio);
  console.log("TRANSCRIPT:", JSON.stringify(text));
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
