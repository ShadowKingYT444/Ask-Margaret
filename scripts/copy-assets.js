// Copies non-TS assets (prompt files) into dist so runtime paths resolve.
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const src = path.join(root, "src", "prompts");
const dest = path.join(root, "dist", "prompts");

if (!fs.existsSync(src)) {
  console.log("[copy-assets] no prompts dir, skipping");
  process.exit(0);
}

fs.mkdirSync(dest, { recursive: true });
for (const file of fs.readdirSync(src)) {
  fs.copyFileSync(path.join(src, file), path.join(dest, file));
  console.log("[copy-assets] copied", file);
}
