const keyInput = document.getElementById("key");
const showBox = document.getElementById("show");
const saveBtn = document.getElementById("save");
const statusEl = document.getElementById("status");
const keyLink = document.getElementById("openKeyLink");

const AISTUDIO_URL = "https://aistudio.google.com/apikey";

showBox.addEventListener("change", () => {
  keyInput.type = showBox.checked ? "text" : "password";
});

keyLink.addEventListener("click", (e) => {
  e.preventDefault();
  window.api.openExternal(AISTUDIO_URL);
});

keyInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveBtn.click();
});

saveBtn.addEventListener("click", async () => {
  const key = keyInput.value.trim();
  statusEl.className = "status";
  if (!key || key.length < 20) {
    statusEl.textContent = "That doesn't look like a valid key. Gemini keys start with 'AIza' and are ~39 chars.";
    statusEl.className = "status error";
    return;
  }
  saveBtn.disabled = true;
  statusEl.textContent = "Saving and verifying...";
  const result = await window.api.saveApiKey(key);
  if (result.ok) {
    statusEl.textContent = "Saved. Starting Ask Margaret...";
    statusEl.className = "status ok";
  } else {
    statusEl.textContent = result.error || "Could not save the key.";
    statusEl.className = "status error";
    saveBtn.disabled = false;
  }
});

keyInput.focus();
