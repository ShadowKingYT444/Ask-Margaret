/* global window, document, navigator, MediaRecorder */

const btn = document.getElementById("btn");
const label = document.getElementById("label");
const closeBtn = document.getElementById("close");

if (closeBtn) {
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    window.api.quitApp();
  });
}

let recording = false;
let mediaRecorder = null;
let chunks = [];
let silenceTimer = null;
let audioCtx = null;
let analyser = null;

const SILENCE_MS = 1800; // auto-stop after 1.8s of silence
const SILENCE_THRESHOLD = 0.012; // RMS below this == silence

function setLabel(text) {
  label.textContent = text;
}

// Turn backend error messages into something a senior user can actually read.
// The full error still goes to devtools for debugging.
function showFriendlyError(raw) {
  const msg = String(raw || "").toLowerCase();
  let friendly = "Try again";
  if (msg.includes("converter") || msg.includes("ffmpeg") || msg.includes("enoent") || msg.includes("spawn")) {
    friendly = "Please reinstall";
  } else if (msg.includes("api key") || msg.includes("api_key") || msg.includes("gemini_api_key")) {
    friendly = "Key missing";
  } else if (msg.includes("internet") || msg.includes("network") || msg.includes("fetch")) {
    friendly = "No internet";
  } else if (msg.includes("microphone") || msg.includes("mic")) {
    friendly = "Mic blocked";
  } else if (msg.includes("didn't hear") || msg.includes("no speech") || msg.includes("speak")) {
    friendly = "Speak louder";
  }
  setLabel(friendly);
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }
}

async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
  chunks = [];

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  mediaRecorder.onstop = async () => {
    btn.classList.remove("recording");
    btn.classList.add("thinking");
    setLabel("Thinking...");

    try {
      const blob = new Blob(chunks, { type: "audio/webm" });
      const audioBufferPromise = blob.arrayBuffer();
      const screenshotPromise = window.api.captureScreen();
      const [audioBuffer, screenshotBytes] = await Promise.all([
        audioBufferPromise,
        screenshotPromise,
      ]);
      // IPC returns a Node Buffer (Uint8Array-compatible). Normalize to ArrayBuffer.
      const screenshotBuffer =
        screenshotBytes instanceof ArrayBuffer
          ? screenshotBytes
          : screenshotBytes.buffer.slice(
              screenshotBytes.byteOffset,
              screenshotBytes.byteOffset + screenshotBytes.byteLength
            );

      const res = await window.api.askMargaret({ audioBuffer, screenshotBuffer });
      if (!res.ok) {
        console.error("askMargaret failed:", res.error);
        showFriendlyError(res.error);
        setTimeout(reset, 5000);
        return;
      }
    } catch (err) {
      console.error(err);
      showFriendlyError(err && err.message ? err.message : String(err));
      setTimeout(reset, 5000);
      return;
    } finally {
      stream.getTracks().forEach((t) => t.stop());
    }
    reset();
  };

  mediaRecorder.start();

  // Wire up silence detection.
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioCtx.createMediaStreamSource(stream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  let lastLoudAt = Date.now();

  function tick() {
    if (!recording) return;
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    if (rms > SILENCE_THRESHOLD) lastLoudAt = Date.now();
    if (Date.now() - lastLoudAt > SILENCE_MS) {
      recording = false;
      stopRecording();
      return;
    }
    requestAnimationFrame(tick);
  }
  // Give a small warm-up before silence detection engages.
  setTimeout(() => {
    lastLoudAt = Date.now();
    tick();
  }, 400);

  btn.classList.add("recording");
  setLabel("I'm listening...");
  recording = true;
}

function reset() {
  btn.classList.remove("recording");
  btn.classList.remove("thinking");
  setLabel("I need help");
  recording = false;
  mediaRecorder = null;
  chunks = [];
}

btn.addEventListener("click", async () => {
  if (btn.classList.contains("thinking")) return;
  if (!recording) {
    try {
      await startRecording();
    } catch (err) {
      console.error("mic error:", err);
      setLabel("Can't hear you");
      setTimeout(reset, 2500);
    }
  } else {
    recording = false;
    stopRecording();
  }
});
