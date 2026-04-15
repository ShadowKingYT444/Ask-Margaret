/* global window, document, Image, SpeechSynthesisUtterance, speechSynthesis */

const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d");
const explanationEl = document.getElementById("explanation");
const gotIt = document.getElementById("got-it");
const againBtn = document.getElementById("again");
const stillBtn = document.getElementById("still");

let preferredVoice = null;

function pickVoice() {
  const voices = speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return null;
  return (
    voices.find((v) => /samantha/i.test(v.name)) ||
    voices.find((v) => /zira/i.test(v.name)) ||
    voices.find((v) => /female/i.test(v.name)) ||
    voices.find((v) => v.lang && v.lang.startsWith("en")) ||
    voices[0]
  );
}

if (typeof speechSynthesis !== "undefined") {
  preferredVoice = pickVoice();
  speechSynthesis.onvoiceschanged = () => {
    preferredVoice = pickVoice();
  };
}

function speak(text) {
  if (typeof speechSynthesis === "undefined") return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.95;
  u.pitch = 1.0;
  if (preferredVoice) u.voice = preferredVoice;
  speechSynthesis.speak(u);
}

function drawAnnotated(base64, verdict) {
  const img = new Image();
  img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    const box = verdict && verdict.target_box;
    if (!box) return;

    const px = (box.x / 1000) * img.width;
    const py = (box.y / 1000) * img.height;
    const pw = (box.w / 1000) * img.width;
    const ph = (box.h / 1000) * img.height;

    const cx = px + pw / 2;
    const cy = py + ph / 2;
    const rx = Math.max(pw * 0.7 + 40, 60);
    const ry = Math.max(ph * 0.7 + 40, 60);

    // Soft halo
    ctx.strokeStyle = "rgba(250, 204, 21, 0.35)";
    ctx.lineWidth = 28;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx + 10, ry + 10, 0, 0, 2 * Math.PI);
    ctx.stroke();

    // Bold yellow ring
    ctx.strokeStyle = "rgba(250, 204, 21, 0.98)";
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
    ctx.stroke();
  };
  img.src = "data:image/png;base64," + base64;
}

window.api.onShowResult(({ screenshotBase64, verdict }) => {
  drawAnnotated(screenshotBase64, verdict);
  const text = (verdict && verdict.explanation) || "Sorry, I couldn't find the answer.";
  explanationEl.textContent = text;
  speak(text);
  stillBtn.disabled = false;
});

gotIt.addEventListener("click", () => {
  speechSynthesis.cancel();
  window.api.closeResult();
});

againBtn.addEventListener("click", () => {
  speak(explanationEl.textContent);
});

stillBtn.addEventListener("click", async () => {
  stillBtn.disabled = true;
  explanationEl.textContent = "Let me look again...";
  speechSynthesis.cancel();
  const res = await window.api.tryAgain();
  if (!res.ok) {
    explanationEl.textContent = "Sorry, I couldn't find another answer.";
    stillBtn.disabled = false;
  }
});

// Tell main to send the cached result as soon as we're ready.
window.api.resultReady();
