/* global window, document, navigator, MediaRecorder, Blob, requestAnimationFrame, Image, SpeechSynthesisUtterance, speechSynthesis */

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

const chatMicBtn = document.getElementById("chatMicBtn");
const chatMicLabel = document.getElementById("chatMicLabel");
const chatStatusEl = document.getElementById("chatStatus");
const chatLogEl = document.getElementById("chatLog");

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

function cancelSpeech() {
  if (typeof speechSynthesis === "undefined") return;
  speechSynthesis.cancel();
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

window.api.onShowResult(({ screenshotBase64, verdict, transcript }) => {
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
  seedChatHistory(transcript, verdict);
});

gotIt.addEventListener("click", () => {
  cancelSpeech();
  window.api.closeResult();
});

againBtn.addEventListener("click", () => {
  speak(lastSpoken || explanationEl.textContent);
});

stillBtn.addEventListener("click", async () => {
  stillBtn.disabled = true;
  explanationEl.textContent = "Let me look again...";
  cancelSpeech();
  const res = await window.api.tryAgain();
  if (!res.ok) {
    explanationEl.textContent = "Sorry, I couldn't find another answer.";
    stillBtn.disabled = false;
  }
});

window.api.resultReady();

/* ---------- Chatbot ---------- */

const SILENCE_MS = 1800;
const SILENCE_THRESHOLD = 0.012;
const MAX_HISTORY_TURNS = 10;

let chatHistory = [];
let chatRecording = false;
let chatThinking = false;

function seedChatHistory(transcript, verdict) {
  chatHistory = [];
  if (transcript && transcript.trim().length > 0) {
    chatHistory.push({ role: "user", content: transcript.trim() });
  }
  const spoken = composeSpeech(verdict);
  if (spoken && spoken.trim().length > 0) {
    chatHistory.push({ role: "assistant", content: spoken.trim() });
  }
}

function setChatStatus(text, isError) {
  chatStatusEl.textContent = text || "";
  chatStatusEl.classList.toggle("error", !!isError);
}

function appendBubble(role, text) {
  const div = document.createElement("div");
  div.className = "bubble " + role;
  div.textContent = text;
  chatLogEl.appendChild(div);
  chatLogEl.scrollTop = chatLogEl.scrollHeight;
}

function setChatButtonState(state) {
  chatMicBtn.classList.remove("recording", "thinking");
  chatMicBtn.disabled = false;
  if (state === "recording") {
    chatMicBtn.classList.add("recording");
    chatMicLabel.textContent = "Listening... (tap to stop)";
  } else if (state === "thinking") {
    chatMicBtn.classList.add("thinking");
    chatMicBtn.disabled = true;
    chatMicLabel.textContent = "Margaret is thinking...";
  } else {
    chatMicLabel.textContent = chatHistory.length > 0
      ? "Ask another question"
      : "Ask a follow-up question";
  }
}

function recordAudio() {
  return new Promise((resolve, reject) => {
    let mediaRecorder = null;
    let stream = null;
    let audioCtx = null;
    let stopped = false;
    const chunks = [];

    const cleanup = () => {
      if (audioCtx) {
        audioCtx.close().catch(() => {});
        audioCtx = null;
      }
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
      }
    };

    const stop = () => {
      if (stopped) return;
      stopped = true;
      chatRecording = false;
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
      }
    };

    // Allow click-to-stop while recording.
    const onClickStop = () => {
      if (chatRecording) stop();
    };
    chatMicBtn.addEventListener("click", onClickStop, { once: true });

    navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => {
      stream = s;
      try {
        mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      } catch (e) {
        cleanup();
        reject(e);
        return;
      }

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        cleanup();
        try {
          const blob = new Blob(chunks, { type: "audio/webm" });
          const buf = await blob.arrayBuffer();
          resolve(buf);
        } catch (err) {
          reject(err);
        }
      };

      mediaRecorder.start();
      chatRecording = true;

      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      let lastLoudAt = Date.now();

      const tick = () => {
        if (stopped) return;
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        if (rms > SILENCE_THRESHOLD) lastLoudAt = Date.now();
        if (Date.now() - lastLoudAt > SILENCE_MS) {
          stop();
          return;
        }
        requestAnimationFrame(tick);
      };
      // Brief warm-up before silence detection engages.
      setTimeout(() => {
        lastLoudAt = Date.now();
        tick();
      }, 400);
    }).catch((err) => {
      cleanup();
      chatMicBtn.removeEventListener("click", onClickStop);
      reject(err);
    });
  });
}

chatMicBtn.addEventListener("click", async () => {
  if (chatRecording || chatThinking) return;
  cancelSpeech();
  setChatStatus("Listening...");
  setChatButtonState("recording");

  let audioBuffer;
  try {
    audioBuffer = await recordAudio();
  } catch (err) {
    console.error("[chat] mic error:", err);
    setChatStatus("I can't access the microphone. Check permissions.", true);
    setChatButtonState("idle");
    return;
  }

  chatThinking = true;
  setChatStatus("Margaret is thinking...");
  setChatButtonState("thinking");

  let res;
  try {
    res = await window.api.chatMargaret({
      audioBuffer,
      history: chatHistory.slice(-MAX_HISTORY_TURNS),
    });
  } catch (err) {
    console.error("[chat] ipc error:", err);
    res = { ok: false, error: String(err && err.message ? err.message : err) };
  }

  chatThinking = false;

  if (!res || !res.ok) {
    setChatStatus(res && res.error ? res.error : "Something went wrong. Try again.", true);
    setChatButtonState("idle");
    return;
  }

  const question = (res.transcribedQuestion || "").trim();
  const answer = (res.answer || "").trim();

  if (question) appendBubble("user", question);
  if (answer) appendBubble("assistant", answer);

  if (question) chatHistory.push({ role: "user", content: question });
  if (answer) chatHistory.push({ role: "assistant", content: answer });

  setChatStatus("");
  setChatButtonState("idle");

  if (answer) speak(answer);
});
