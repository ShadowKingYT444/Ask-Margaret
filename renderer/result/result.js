/* global window, document, Image, SpeechSynthesisUtterance, speechSynthesis */

const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d");
const zoomCanvas = document.getElementById("zoomCanvas");
const zoomCtx = zoomCanvas.getContext("2d");

const explanationEl = document.getElementById("explanation");
const gotIt = document.getElementById("got-it");
const againBtn = document.getElementById("again");
const stillBtn = document.getElementById("still");

const visualEl = document.getElementById("visual");
const scamViewEl = document.getElementById("scamView");
const readViewEl = document.getElementById("readView");
const walkProgEl = document.getElementById("walkProgress");

let preferredVoice = null;
let lastSpoken = "";

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
  if (!text || typeof speechSynthesis === "undefined") return;
  speechSynthesis.cancel();
  lastSpoken = text;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.95;
  u.pitch = 1.0;
  if (preferredVoice) u.voice = preferredVoice;
  speechSynthesis.speak(u);
}

function hideAll() {
  visualEl.classList.add("hidden");
  scamViewEl.classList.add("hidden");
  readViewEl.classList.add("hidden");
  walkProgEl.classList.add("hidden");
}

function drawCircle(context, cx, cy, rx, ry) {
  context.strokeStyle = "rgba(250, 204, 21, 0.35)";
  context.lineWidth = 28;
  context.beginPath();
  context.ellipse(cx, cy, rx + 10, ry + 10, 0, 0, 2 * Math.PI);
  context.stroke();
  context.strokeStyle = "rgba(250, 204, 21, 0.98)";
  context.lineWidth = 14;
  context.beginPath();
  context.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
  context.stroke();
}

function renderClickOrWalk(screenshotBase64, verdict) {
  visualEl.classList.remove("hidden");
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
    drawCircle(ctx, cx, cy, rx, ry);

    // Zoom inset: crop around target and draw onto zoom canvas.
    const pad = Math.max(pw, ph) * 2.5 + 100;
    const sx = Math.max(0, cx - pad);
    const sy = Math.max(0, cy - pad);
    const sw = Math.min(img.width - sx, pad * 2);
    const sh = Math.min(img.height - sy, pad * 2);

    const dispW = 800;
    const dispH = Math.round((sh / sw) * dispW);
    zoomCanvas.width = dispW;
    zoomCanvas.height = dispH;
    zoomCtx.imageSmoothingEnabled = true;
    zoomCtx.imageSmoothingQuality = "high";
    zoomCtx.drawImage(img, sx, sy, sw, sh, 0, 0, dispW, dispH);

    const zx = ((cx - sx) / sw) * dispW;
    const zy = ((cy - sy) / sh) * dispH;
    const zrx = (rx / sw) * dispW;
    const zry = (ry / sh) * dispH;
    drawCircle(zoomCtx, zx, zy, zrx, zry);
  };
  img.src = "data:image/png;base64," + screenshotBase64;
}

function renderWalkProgress(verdict) {
  walkProgEl.classList.remove("hidden");
  const steps = Array.isArray(verdict.steps) ? verdict.steps : [];
  const total = verdict.total_steps || steps.length || 1;
  const cur = Math.max(1, Math.min(total, verdict.current_step || 1));
  document.getElementById("stepNum").textContent = String(cur);
  document.getElementById("stepTotal").textContent = String(total);
  document.getElementById("goalText").textContent = verdict.goal ? "Goal: " + verdict.goal : "";
  const list = document.getElementById("stepList");
  list.innerHTML = "";
  steps.forEach((s, i) => {
    const li = document.createElement("li");
    li.textContent = s;
    if (i + 1 < cur) li.classList.add("done");
    else if (i + 1 === cur) li.classList.add("current");
    list.appendChild(li);
  });

  const wrap = document.getElementById("suggestedWrap");
  if (verdict.suggested_text && verdict.suggested_text.length > 0) {
    wrap.classList.remove("hidden");
    document.getElementById("suggestedText").textContent = verdict.suggested_text;
  } else {
    wrap.classList.add("hidden");
  }
}

function renderScam(verdict) {
  scamViewEl.classList.remove("hidden");
  const badge = document.getElementById("scamBadge");
  badge.className = "";
  badge.classList.add(verdict.verdict || "caution");
  badge.textContent =
    verdict.verdict === "danger" ? "Danger" :
    verdict.verdict === "safe" ? "Looks Safe" : "Be Careful";

  document.getElementById("scamHeadline").textContent = verdict.headline || "";
  const ul = document.getElementById("scamReasons");
  ul.innerHTML = "";
  (verdict.reasons || []).forEach((r) => {
    const li = document.createElement("li");
    li.textContent = r;
    ul.appendChild(li);
  });
  document.getElementById("scamAction").textContent = verdict.what_to_do || "";
}

function renderRead(verdict) {
  readViewEl.classList.remove("hidden");
  document.getElementById("readKind").textContent = (verdict.kind || "page").toUpperCase();
  document.getElementById("readTitle").textContent = verdict.title || "";
  document.getElementById("readSummary").textContent = verdict.summary || "";
  const ul = document.getElementById("readBullets");
  ul.innerHTML = "";
  (verdict.bullets || []).forEach((b) => {
    const li = document.createElement("li");
    li.textContent = b;
    ul.appendChild(li);
  });
  const action = document.getElementById("readAction");
  if (verdict.action_needed && verdict.action_needed.length > 0) {
    action.textContent = "What to do: " + verdict.action_needed;
    action.style.display = "";
  } else {
    action.style.display = "none";
  }
}

function composeSpeech(verdict) {
  if (!verdict) return "";
  if (verdict.mode === "scam_check") {
    const parts = [verdict.headline, ...(verdict.reasons || []), verdict.what_to_do];
    return parts.filter(Boolean).join(". ");
  }
  if (verdict.mode === "read_explain") {
    return verdict.read_aloud || [verdict.title, verdict.summary].filter(Boolean).join(". ");
  }
  if (verdict.mode === "walkthrough") {
    const step = verdict.steps && verdict.steps[Math.max(0, (verdict.current_step || 1) - 1)];
    return [verdict.explanation || verdict.goal, step].filter(Boolean).join(". ");
  }
  return verdict.explanation || "";
}

function composeHeadline(verdict) {
  if (!verdict) return "";
  if (verdict.mode === "scam_check") return verdict.headline || "";
  if (verdict.mode === "read_explain") return verdict.summary || verdict.title || "";
  if (verdict.mode === "walkthrough") return verdict.explanation || verdict.goal || "";
  return verdict.explanation || "";
}

window.api.onShowResult(({ screenshotBase64, verdict }) => {
  hideAll();
  const mode = verdict && verdict.mode;
  if (mode === "scam_check") {
    renderScam(verdict);
  } else if (mode === "read_explain") {
    renderRead(verdict);
  } else if (mode === "walkthrough") {
    renderClickOrWalk(screenshotBase64, verdict);
    renderWalkProgress(verdict);
  } else {
    renderClickOrWalk(screenshotBase64, verdict);
  }
  explanationEl.textContent = composeHeadline(verdict) || "Here's what I found.";
  speak(composeSpeech(verdict));
  stillBtn.disabled = false;
});

gotIt.addEventListener("click", () => {
  speechSynthesis.cancel();
  window.api.closeResult();
});

againBtn.addEventListener("click", () => {
  speak(lastSpoken || explanationEl.textContent);
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

window.api.resultReady();
