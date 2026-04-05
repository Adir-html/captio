// Empty string = relative URL, works on Vercel (same origin) and with `vercel dev`.
// For local dev without Vercel CLI, change to "http://127.0.0.1:8000" and run
// uvicorn api.index:app --reload from the project root.
const API_BASE = "";

// ── Element refs ──────────────────────────────────────────────────────────
const imageInput        = document.getElementById("imageInput");
const uploadArea        = document.getElementById("uploadArea");
const uploadPlaceholder = document.getElementById("uploadPlaceholder");
const uploadPreview     = document.getElementById("uploadPreview");
const imagePreview      = document.getElementById("imagePreview");
const uploadLabel       = document.getElementById("uploadLabel");
const removeFileBtn     = document.getElementById("removeFileBtn");
const generateBtn       = document.getElementById("generateBtn");
const btnText           = document.getElementById("btnText");
const btnSpinner        = document.getElementById("btnSpinner");
const btnIcon           = document.getElementById("btnIcon");
const errorBanner       = document.getElementById("errorBanner");
const errorText         = document.getElementById("errorText");
const emptyState        = document.getElementById("emptyState");
const resultCards       = document.getElementById("resultCards");
const resultGrid        = document.getElementById("resultGrid");
const outTitle          = document.getElementById("outTitle");
const outDescription    = document.getElementById("outDescription");
const outAd             = document.getElementById("outAd");
const outBullets        = document.getElementById("outBullets");
const typeBadge         = document.getElementById("typeBadge");
const langBadge         = document.getElementById("langBadge");
const toneBadge         = document.getElementById("toneBadge");
const copyAllBtn        = document.getElementById("copyAllBtn");
const regenerateBtn     = document.getElementById("regenerateBtn");
const usageCount        = document.getElementById("usageCount");
const usageCounter      = document.getElementById("usageCounter");
const exportTxtBtn      = document.getElementById("exportTxtBtn");
const exportJsonBtn     = document.getElementById("exportJsonBtn");

// ── Constants ─────────────────────────────────────────────────────────────

const CHECKMARK_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <polyline points="20 6 9 17 4 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const USAGE_LIMIT = 3;

// Maps image_type value from API → CSS modifier class
const TYPE_CLASS = {
  product:  "badge--product",
  person:   "badge--person",
  ui:       "badge--ui",
  code:     "badge--code",
  document: "badge--document",
  service:  "badge--service",
  scene:    "badge--scene",
};

// Human-readable labels for image_type values
const TYPE_LABEL = {
  product:  "Product",
  person:   "Person",
  ui:       "UI / App",
  code:     "Code",
  document: "Document",
  service:  "Service",
  scene:    "Scene",
};

const TONE_LABEL = {
  professional: "Professional",
  concise:      "Concise",
  marketing:    "Marketing",
  descriptive:  "Descriptive",
};

let lastResult = null;

// ── Usage counter ─────────────────────────────────────────────────────────

function todayKey() {
  return `usage_${new Date().toISOString().slice(0, 10)}`;
}

function getUsage() {
  return parseInt(localStorage.getItem(todayKey()) || "0", 10);
}

function incrementUsage() {
  const next = getUsage() + 1;
  localStorage.setItem(todayKey(), next);
  renderUsage(next);
}

function renderUsage(count) {
  usageCount.textContent = count;
  usageCounter.classList.toggle("warn", count >= USAGE_LIMIT);
}

renderUsage(getUsage());

// ── Tone selection ────────────────────────────────────────────────────────

function getActiveTone() {
  const active = document.querySelector(".tone-pill.active");
  return active ? active.dataset.tone : "professional";
}

document.getElementById("tonePills").addEventListener("click", (e) => {
  const pill = e.target.closest(".tone-pill");
  if (!pill) return;
  document.querySelectorAll(".tone-pill").forEach(p => {
    p.classList.remove("active");
    p.setAttribute("aria-pressed", "false");
  });
  pill.classList.add("active");
  pill.setAttribute("aria-pressed", "true");
});

// ── Helpers ───────────────────────────────────────────────────────────────

function showError(msg) {
  errorText.textContent = msg;
  errorBanner.hidden = false;
}

function clearError() {
  errorBanner.hidden = true;
}

function revokeBlobUrl() {
  if (imagePreview.src.startsWith("blob:")) URL.revokeObjectURL(imagePreview.src);
}

function openFilePicker() {
  imageInput.value = "";
  imageInput.click();
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── File handling ─────────────────────────────────────────────────────────

function applyFile(file) {
  clearError();
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    showError("Please select an image file (JPEG, PNG, WebP, etc.).");
    return;
  }

  revokeBlobUrl();
  imagePreview.src = URL.createObjectURL(file);
  uploadLabel.textContent = file.name;
  uploadPlaceholder.hidden = true;
  uploadPreview.hidden = false;

  // Sync dragged/example file into the native input so FormData works.
  // DataTransfer not universally available — fail silently.
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    imageInput.files = dt.files;
  } catch {}
}

function clearFile() {
  revokeBlobUrl();
  imageInput.value = "";
  imagePreview.removeAttribute("src");
  uploadLabel.textContent = "";
  uploadPreview.hidden = true;
  uploadPlaceholder.hidden = false;
  uploadArea.classList.remove("drag-over");
}

// ── Upload interactions ───────────────────────────────────────────────────

uploadArea.addEventListener("click", (e) => {
  if (removeFileBtn.contains(e.target)) return;
  openFilePicker();
});

uploadArea.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    openFilePicker();
  }
});

imageInput.addEventListener("change", () => applyFile(imageInput.files[0]));

removeFileBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  clearFile();
});

// Drag & drop
uploadArea.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadArea.classList.add("drag-over");
});

uploadArea.addEventListener("dragleave", (e) => {
  if (!uploadArea.contains(e.relatedTarget)) uploadArea.classList.remove("drag-over");
});

uploadArea.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadArea.classList.remove("drag-over");
  applyFile(e.dataTransfer.files[0]);
});

// Paste anywhere on the page
document.addEventListener("paste", (e) => {
  const item = [...e.clipboardData.items].find(i => i.type.startsWith("image/"));
  if (item) applyFile(item.getAsFile());
});

// ── Example cards → trigger file picker ──────────────────────────────────

document.getElementById("examplesTrack").addEventListener("click", (e) => {
  const card = e.target.closest(".example-card");
  if (!card) return;

  // Scroll upload section into view and open picker
  document.getElementById("upload-section").scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(openFilePicker, 400);
});

// ── Loading state ─────────────────────────────────────────────────────────

function setLoading(on) {
  generateBtn.disabled = on;
  regenerateBtn.disabled = on;
  btnText.textContent = on ? "Generating…" : "Generate Copy";
  btnSpinner.hidden = !on;
  btnIcon.hidden = on;
}

// ── Render results ────────────────────────────────────────────────────────

function renderResults(data) {
  outTitle.textContent       = data.title;
  outDescription.textContent = data.description;
  outAd.textContent          = data.ad;
  outBullets.innerHTML       = data.bullets.map(b => `<li>${b}</li>`).join("");

  // Type badge
  const type = (data.image_type || "").toLowerCase();
  typeBadge.className = `badge ${TYPE_CLASS[type] || "badge--scene"}`;
  typeBadge.textContent = TYPE_LABEL[type] || type || "Image";
  typeBadge.hidden = !type;

  // Language badge
  if (data.language) {
    langBadge.textContent = data.language;
    langBadge.hidden = false;
  } else {
    langBadge.hidden = true;
  }

  // Tone badge
  const tone = getActiveTone();
  toneBadge.textContent = TONE_LABEL[tone] || tone;
  toneBadge.hidden = false;

  emptyState.hidden = true;
  resultCards.hidden = false;
  resultGrid.classList.remove("visible");
  requestAnimationFrame(() => resultGrid.classList.add("visible"));
  resultCards.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ── Generate ──────────────────────────────────────────────────────────────

async function generate() {
  clearError();

  const file = imageInput.files[0];
  if (!file) {
    showError("Please upload an image before generating.");
    return;
  }

  const formData = new FormData();
  formData.append("image", file);
  formData.append("product_name", document.getElementById("productName").value.trim());
  formData.append("tone", getActiveTone());

  setLoading(true);
  resultGrid.classList.remove("visible");

  try {
    const res = await fetch(`${API_BASE}/api/generate`, { method: "POST", body: formData });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || err.detail || `Server error (${res.status})`);
    }

    const data = await res.json();
    lastResult = data;
    renderResults(data);
    if (typeof data.usage === "number") {
      renderUsage(data.usage);
    } else {
      incrementUsage();
    }

  } catch (err) {
    showError(
      err instanceof TypeError
        ? "Cannot reach the backend. Make sure it is running (see README)."
        : err.message
    );
  } finally {
    setLoading(false);
  }
}

generateBtn.addEventListener("click", generate);
regenerateBtn.addEventListener("click", generate);

// ── Copy All ──────────────────────────────────────────────────────────────

copyAllBtn.addEventListener("click", async () => {
  if (!lastResult) return;

  const text = [
    `Title: ${lastResult.title}`,
    "",
    `Key Points:\n${lastResult.bullets.map(b => `• ${b}`).join("\n")}`,
    "",
    `Description:\n${lastResult.description}`,
    "",
    `Ad Script:\n${lastResult.ad}`,
  ].join("\n");

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return;
  }

  const defaultHTML = copyAllBtn.innerHTML;
  copyAllBtn.innerHTML = `${CHECKMARK_SVG} Copied All!`;
  copyAllBtn.classList.add("success-flash");
  setTimeout(() => {
    copyAllBtn.innerHTML = defaultHTML;
    copyAllBtn.classList.remove("success-flash");
  }, 2000);
});

// ── Export TXT ────────────────────────────────────────────────────────────

exportTxtBtn.addEventListener("click", () => {
  if (!lastResult) return;
  const text = [
    `Title: ${lastResult.title}`,
    "",
    `Key Points:`,
    ...lastResult.bullets.map(b => `• ${b}`),
    "",
    `Description:`,
    lastResult.description,
    "",
    `Ad Script:`,
    lastResult.ad,
  ].join("\n");
  downloadFile(text, "generated-copy.txt", "text/plain");
});

// ── Export JSON ───────────────────────────────────────────────────────────

exportJsonBtn.addEventListener("click", () => {
  if (!lastResult) return;
  downloadFile(JSON.stringify(lastResult, null, 2), "generated-copy.json", "application/json");
});

// ── Per-card copy buttons ─────────────────────────────────────────────────

document.querySelectorAll(".copy-btn").forEach(btn => {
  const defaultHTML = btn.innerHTML;

  btn.addEventListener("click", async () => {
    if (!lastResult) return;

    const key  = btn.dataset.copy;
    const text = key === "bullets"
      ? lastResult.bullets.map(b => `• ${b}`).join("\n")
      : lastResult[key] ?? "";

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }

    btn.innerHTML = `${CHECKMARK_SVG} Copied!`;
    btn.classList.add("copied");
    setTimeout(() => {
      btn.innerHTML = defaultHTML;
      btn.classList.remove("copied");
    }, 2000);
  });
});
