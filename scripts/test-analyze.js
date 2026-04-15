// Standalone harness: feed a real PNG + transcript to the analyze pipeline.
// Usage: node scripts/test-analyze.js [imagePath] [transcript]
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const imagePath = process.argv[2] || path.join(__dirname, "..", "test_screens", "live.png");
const transcript = process.argv[3] || "What is on my screen right now and what should I press first?";

(async () => {
  if (!fs.existsSync(imagePath)) {
    console.error("Missing image:", imagePath);
    process.exit(2);
  }
  const screenshot = fs.readFileSync(imagePath);
  console.log(`[test] image=${imagePath} (${screenshot.length}B) transcript=${JSON.stringify(transcript)}`);

  const { analyze, analyzeFollowup } = require(path.join(__dirname, "..", "dist", "ai", "analyze.js"));
  try {
    const verdict = await analyze(screenshot, transcript);
    console.log("[test] verdict:", JSON.stringify(verdict, null, 2));
    const follow = await analyzeFollowup(screenshot, transcript, verdict);
    console.log("[test] follow-up:", JSON.stringify(follow, null, 2));
    process.exit(0);
  } catch (e) {
    console.error("[test] FAIL:", e && e.stack ? e.stack : e);
    process.exit(1);
  }
})();
