/* global pdfjsLib */

const DEFAULT_PDF = "./book.pdf";
const FLIP_MS = 720;

const pdfUrl = DEFAULT_PDF;

const els = {
  title: document.getElementById("docTitle"),
  loader: document.getElementById("loader"),
  loaderText: document.getElementById("loaderText"),
  progressBar: document.getElementById("progressBar"),
  desk: document.getElementById("desk"),
  book: document.getElementById("book"),
  pageLeft: document.getElementById("pageLeft"),
  pageRight: document.getElementById("pageRight"),
  leaf: document.getElementById("leaf"),
  prevBtn: document.getElementById("prevBtn"),
  nextBtn: document.getElementById("nextBtn"),
  pageInput: document.getElementById("pageInput"),
  pageTotal: document.getElementById("pageTotal"),
  scrubber: document.getElementById("scrubber"),
  spreadBtn: document.getElementById("spreadBtn"),
  helpBtn: document.getElementById("helpBtn"),
  helpModal: document.getElementById("helpModal"),
  helpClose: document.getElementById("helpClose"),
  fullscreenBtn: document.getElementById("fullscreenBtn"),
  hint: document.getElementById("hint"),
};

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const state = {
  pdf: null,
  pageCount: 0,
  cursor: 1,
  spread: true,
  flipping: false,
  renderToken: 0,
  pageCache: new Map(),
  pageSize: { width: 1, height: 1.414 },
};

function setProgress(pct, label) {
  els.progressBar.style.width = `${pct}%`;
  els.progressBar.parentElement.setAttribute("aria-valuenow", String(Math.round(pct)));
  if (label) els.loaderText.textContent = label;
}

function fileTitle(url) {
  try {
    const name = decodeURIComponent(url.split("/").pop() || "Book");
    return name.replace(/\.pdf$/i, "").replace(/[-_]+/g, " ");
  } catch {
    return "Book";
  }
}

function canvasOf(el) {
  return el.querySelector("canvas");
}

function leafCanvases() {
  return {
    front: canvasOf(els.leaf.querySelector(".face.front")),
    back: canvasOf(els.leaf.querySelector(".face.back")),
  };
}

function desiredPageWidth() {
  const stage = document.getElementById("stage");
  const chrome = document.querySelector(".chrome");
  const availableH = Math.max(280, window.innerHeight - chrome.offsetHeight - 110);
  const boards = state.spread ? 38 : 28;
  const maxW = Math.max(280, stage.clientWidth - 48 - boards);
  const ratio = state.pageSize.height / state.pageSize.width;
  let pageW = state.spread ? maxW / 2 : maxW;
  const pageH = pageW * ratio;
  if (pageH > availableH) pageW = availableH / ratio;
  return Math.max(160, Math.min(pageW, 560));
}

function applyPageMetrics() {
  const pageW = desiredPageWidth();
  const pageH = pageW * (state.pageSize.height / state.pageSize.width);
  document.documentElement.style.setProperty("--page-w", `${pageW}px`);
  document.documentElement.style.setProperty("--page-h", `${pageH}px`);
  return { pageW, pageH };
}

function dprScale() {
  return Math.min(2, window.devicePixelRatio || 1);
}

async function renderPageToCanvas(pageNumber, canvas, widthCss) {
  const host = canvas.parentElement;
  if (!pageNumber || pageNumber < 1 || pageNumber > state.pageCount) {
    canvas.width = 2;
    canvas.height = 2;
    canvas.getContext("2d").clearRect(0, 0, 2, 2);
    host?.classList.add("empty");
    return;
  }
  host?.classList.remove("empty");

  const scale = dprScale();
  const cacheKey = `${pageNumber}:${Math.round(widthCss)}:${scale}`;
  let bitmap = state.pageCache.get(cacheKey);
  if (!bitmap) {
    const page = await state.pdf.getPage(pageNumber);
    const unscaled = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: (widthCss / unscaled.width) * scale });
    const off = document.createElement("canvas");
    off.width = viewport.width;
    off.height = viewport.height;
    await page.render({ canvasContext: off.getContext("2d"), viewport }).promise;
    bitmap = off;
    if (state.pageCache.size > 48) {
      const first = state.pageCache.keys().next().value;
      state.pageCache.delete(first);
    }
    state.pageCache.set(cacheKey, bitmap);
  }
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
}

/** 1-based pages currently sitting on the left/right boards. */
function visiblePages(cursor = state.cursor) {
  if (!state.spread) {
    return { left: null, right: cursor };
  }
  if (cursor <= 1) {
    return { left: null, right: 1 };
  }
  const left = cursor % 2 === 0 ? cursor : cursor - 1;
  return { left, right: left + 1 };
}

function normalizeCursor(page) {
  const n = Math.min(Math.max(1, page), state.pageCount);
  if (!state.spread) return n;
  if (n <= 1) return 1;
  return n % 2 === 0 ? n : n - 1;
}

function atStart(cursor = state.cursor) {
  return cursor <= 1;
}

function atEnd(cursor = state.cursor) {
  const { right } = visiblePages(cursor);
  return (right || 1) >= state.pageCount;
}

function nextCursor() {
  if (!state.spread) return Math.min(state.cursor + 1, state.pageCount);
  if (state.cursor === 1) return 2;
  return normalizeCursor(state.cursor + 2);
}

function prevCursor() {
  if (!state.spread) return Math.max(state.cursor - 1, 1);
  if (state.cursor <= 2) return 1;
  return state.cursor - 2;
}

function updateChrome() {
  const { left, right } = visiblePages();
  const current = left || right;
  els.pageInput.value = String(current);
  els.pageInput.max = String(state.pageCount);
  els.pageTotal.textContent = `/ ${state.pageCount}`;
  els.scrubber.max = String(state.pageCount);
  els.scrubber.value = String(current);
  els.prevBtn.disabled = atStart();
  els.nextBtn.disabled = atEnd();
  els.spreadBtn.textContent = state.spread ? "Single page" : "Spread";
  els.book.classList.toggle("single", !state.spread);
}

async function paintSpread() {
  const token = ++state.renderToken;
  const { pageW } = applyPageMetrics();
  const { left, right } = visiblePages();
  await Promise.all([
    renderPageToCanvas(left, canvasOf(els.pageLeft), pageW),
    renderPageToCanvas(right, canvasOf(els.pageRight), pageW),
  ]);
  if (token !== state.renderToken) return;
  updateChrome();
}

function waitForFlip() {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      els.leaf.removeEventListener("transitionend", onEnd);
      resolve();
    };
    const onEnd = (event) => {
      if (event.propertyName === "transform") done();
    };
    els.leaf.addEventListener("transitionend", onEnd);
    setTimeout(done, FLIP_MS + 90);
  });
}

async function animateFlip(direction) {
  if (state.flipping) return;
  const goingNext = direction === "next";
  if (goingNext && atEnd()) return;
  if (!goingNext && atStart()) return;

  state.flipping = true;
  const { pageW } = applyPageMetrics();
  const from = visiblePages();
  const target = goingNext ? nextCursor() : prevCursor();
  const to = visiblePages(target);
  const { front, back } = leafCanvases();

  els.leaf.hidden = false;
  els.leaf.classList.toggle("from-right", goingNext);
  els.leaf.classList.toggle("from-left", !goingNext);

  if (goingNext) {
    await Promise.all([
      renderPageToCanvas(from.right, front, pageW),
      renderPageToCanvas(state.spread ? to.left : null, back, pageW),
      renderPageToCanvas(from.left, canvasOf(els.pageLeft), pageW),
      renderPageToCanvas(to.right, canvasOf(els.pageRight), pageW),
    ]);
  } else {
    await Promise.all([
      renderPageToCanvas(state.spread ? from.left : from.right, back, pageW),
      renderPageToCanvas(to.right, front, pageW),
      renderPageToCanvas(to.left, canvasOf(els.pageLeft), pageW),
      renderPageToCanvas(from.right, canvasOf(els.pageRight), pageW),
    ]);
  }

  const origin = goingNext ? "left center" : "right center";
  els.leaf.style.transformOrigin = origin;
  els.leaf.style.transition = "none";
  els.leaf.style.transform = "rotateY(0deg)";
  void els.leaf.offsetWidth;
  els.leaf.style.transition = `transform ${FLIP_MS}ms var(--ease-flip)`;
  els.leaf.style.transform = goingNext ? "rotateY(-180deg)" : "rotateY(180deg)";

  await waitForFlip();

  els.leaf.hidden = true;
  els.leaf.style.transition = "none";
  els.leaf.style.transform = "none";
  state.cursor = target;
  await paintSpread();
  state.flipping = false;
}

async function goToPage(page, { animate = true } = {}) {
  const dest = normalizeCursor(page);
  if (dest === state.cursor) {
    await paintSpread();
    return;
  }
  const adjacent = dest === nextCursor() || dest === prevCursor();
  if (animate && adjacent) {
    await animateFlip(dest > state.cursor ? "next" : "prev");
    return;
  }
  state.cursor = dest;
  await paintSpread();
}

function bindPointerFlip() {
  let startX = 0;
  let tracking = false;

  els.book.addEventListener("pointerdown", (event) => {
    if (state.flipping) return;
    tracking = true;
    startX = event.clientX;
  });

  window.addEventListener("pointerup", (event) => {
    if (!tracking) return;
    tracking = false;
    const x = event.clientX;
    const dx = x - startX;
    const rect = els.book.getBoundingClientRect();
    const edge = 0.28 * rect.width;
    const localX = x - rect.left;

    if (Math.abs(dx) > 48) {
      animateFlip(dx < 0 ? "next" : "prev");
      return;
    }
    if (localX > rect.width - edge) animateFlip("next");
    else if (localX < edge) animateFlip("prev");
  });
}

async function boot(loadingTask) {
  els.title.textContent = fileTitle(pdfUrl);
  document.title = `${fileTitle(pdfUrl)} — Folio`;

  try {
    const pdf = await loadingTask.promise;
    state.pdf = pdf;
    state.pageCount = pdf.numPages;

    const first = await pdf.getPage(1);
    const viewport = first.getViewport({ scale: 1 });
    state.pageSize = { width: viewport.width, height: viewport.height };

    const meta = await pdf.getMetadata().catch(() => null);
    const infoTitle = meta?.info?.Title;
    if (infoTitle) {
      els.title.textContent = infoTitle;
      document.title = `${infoTitle} — Folio`;
    }

    setProgress(100, "Binding the signatures…");
    els.loader.hidden = true;
    els.desk.hidden = false;
    state.spread = window.matchMedia("(min-width: 900px)").matches;
    state.cursor = 1;
    await paintSpread();
    els.hint.textContent = `${state.pageCount} pages · click an edge, drag, or use the arrow keys`;
  } catch (error) {
    console.error(error);
    setProgress(
      0,
      "Could not open this PDF. Serve the folder over HTTP (GitHub Pages, or python3 -m http.server) instead of opening the file directly."
    );
  }
}

els.prevBtn.addEventListener("click", () => animateFlip("prev"));
els.nextBtn.addEventListener("click", () => animateFlip("next"));

els.pageInput.addEventListener("change", () => {
  const n = Number(els.pageInput.value);
  if (Number.isFinite(n)) goToPage(n, { animate: false });
});

els.scrubber.addEventListener("input", () => {
  els.pageInput.value = els.scrubber.value;
});
els.scrubber.addEventListener("change", () => {
  goToPage(Number(els.scrubber.value), { animate: false });
});

els.spreadBtn.addEventListener("click", async () => {
  const { left, right } = visiblePages();
  state.spread = !state.spread;
  state.cursor = normalizeCursor(left || right);
  state.pageCache.clear();
  await paintSpread();
});

els.fullscreenBtn.addEventListener("click", async () => {
  if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
  else await document.exitFullscreen?.();
});

const toggleHelp = () => {
  els.helpModal.hidden = !els.helpModal.hidden;
};
els.helpBtn.addEventListener("click", toggleHelp);
els.helpClose.addEventListener("click", toggleHelp);
els.helpModal.addEventListener("click", (event) => {
  if (event.target === els.helpModal) toggleHelp();
});

window.addEventListener("keydown", (event) => {
  if (event.target.matches("input, textarea")) return;
  if (event.key === "ArrowRight" || event.key === "l" || event.key === "L" || event.key === " ") {
    event.preventDefault();
    animateFlip("next");
  } else if (event.key === "ArrowLeft" || event.key === "j" || event.key === "J") {
    animateFlip("prev");
  } else if (event.key === "Home") {
    goToPage(1, { animate: false });
  } else if (event.key === "End") {
    goToPage(state.pageCount, { animate: false });
  } else if (event.key === "f" || event.key === "F") {
    els.fullscreenBtn.click();
  } else if (event.key === "s" || event.key === "S") {
    els.spreadBtn.click();
  } else if (event.key === "?" || event.key === "h") {
    toggleHelp();
  } else if (event.key === "Escape" && !els.helpModal.hidden) {
    els.helpModal.hidden = true;
  }
});

let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    state.pageCache.clear();
    paintSpread();
  }, 180);
});

bindPointerFlip();

const loadingTask = pdfjsLib.getDocument({ url: pdfUrl });
loadingTask.onProgress = (p) => {
  if (!p.total) return;
  setProgress((p.loaded / p.total) * 100, "Fetching the manuscript…");
};
boot(loadingTask);
