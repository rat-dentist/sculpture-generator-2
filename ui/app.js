import { generateForm } from "./engine/form-engine.js";
import { buildStrokeScene } from "./engine/mark-engine.js";
import { extractMergedFaces } from "./engine/mesher.js";
import { projectFaces } from "./engine/projection.js";
import { randomSeed } from "./engine/random.js";
import { buildExportSvg, buildPreviewSvg } from "./engine/svg-export.js";

const refs = {
  previewHost: document.getElementById("preview-host"),
  statusLine: document.getElementById("status-line"),
  seed: document.getElementById("seed"),
  btnNewSeed: document.getElementById("btn-new-seed"),
  btnRebuild: document.getElementById("btn-rebuild"),
  btnExport: document.getElementById("btn-export")
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function numeric(id, fallback) {
  const element = document.getElementById(id);
  const value = Number(element?.value);
  return Number.isFinite(value) ? value : fallback;
}

function integer(id, fallback) {
  return Math.round(numeric(id, fallback));
}

function checked(id) {
  return Boolean(document.getElementById(id)?.checked);
}

function readSettings() {
  const seed = integer("seed", 1042);

  return {
    seed,
    form: {
      seed,
      width: clamp(integer("grid-width", 10), 4, 30),
      depth: clamp(integer("grid-depth", 10), 4, 30),
      height: clamp(integer("grid-height", 12), 4, 40),
      massCount: clamp(integer("mass-count", 4), 1, 16),
      carveCount: clamp(integer("carve-count", 5), 0, 24),
      bridgeCount: clamp(integer("bridge-count", 3), 0, 12),
      supportRatio: clamp(numeric("support-ratio", 0.2), 0, 1)
    },
    view: {
      yawDeg: numeric("view-yaw", 45),
      scale: numeric("view-scale", 30)
    },
    mark: {
      seed,
      modeByFace: {
        top: document.getElementById("shade-top")?.value || "none",
        left: document.getElementById("shade-left")?.value || "none",
        right: document.getElementById("shade-right")?.value || "none"
      },
      hatchSpacing: clamp(numeric("hatch-spacing", 5), 1, 30),
      hatchAngle: numeric("hatch-angle", 25),
      contourStep: clamp(numeric("contour-step", 4), 1, 30),
      stippleSpacing: clamp(numeric("stipple-spacing", 6), 1, 30),
      maxStrokes: clamp(integer("max-strokes", 7000), 100, 60000),
      minSegment: clamp(numeric("min-segment", 0.8), 0.01, 20),
      groundShadow: checked("shadow-ground")
    },
    preview: {
      showFaces: checked("show-faces"),
      showOutline: checked("show-outline"),
      showInternal: checked("show-internal"),
      showMidtone: checked("show-midtone"),
      showDense: checked("show-dense")
    }
  };
}

function formKey(settings) {
  return JSON.stringify(settings.form);
}

const cache = {
  formKey: "",
  rawFaces: [],
  scene: null,
  lastSettings: null
};

function updateStatus(text) {
  refs.statusLine.textContent = text;
}

function buildScene(settings, forceFormRebuild = false) {
  const key = formKey(settings);

  if (forceFormRebuild || key !== cache.formKey) {
    const grid = generateForm(settings.form);
    cache.rawFaces = extractMergedFaces(grid);
    cache.formKey = key;
  }

  const projectedFaces = projectFaces(cache.rawFaces, settings.view);
  cache.scene = buildStrokeScene(projectedFaces, settings.mark);
  cache.lastSettings = settings;

  return cache.scene;
}

function render(forceFormRebuild = false) {
  try {
    const settings = readSettings();
    const scene = buildScene(settings, forceFormRebuild);
    refs.previewHost.innerHTML = buildPreviewSvg(scene, settings.preview);

    updateStatus(
      `faces ${scene.stats.faceCount} | strokes ${scene.stats.totalStrokes} | clipped ${scene.stats.clippedStrokes} | A ${scene.stats.outlineStrokes + scene.stats.internalStrokes} | B ${scene.stats.midtoneStrokes} | C ${scene.stats.denseStrokes}`
    );
  } catch (error) {
    updateStatus(`render error: ${String(error.message || error)}`);
  }
}

let pendingForce = false;
let queued = false;

function scheduleRender(forceFormRebuild = false) {
  pendingForce = pendingForce || forceFormRebuild;
  if (queued) {
    return;
  }

  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    const force = pendingForce;
    pendingForce = false;
    render(force);
  });
}

async function exportCurrent() {
  if (!cache.scene || !cache.lastSettings) {
    render(true);
  }

  const settings = cache.lastSettings || readSettings();
  const svg = buildExportSvg(cache.scene, {
    title: "Iso Plot Export",
    seed: settings.seed
  });
  const defaultName = `sculpture-seed-${settings.seed}.svg`;

  if (window.desktopApi?.saveSvg) {
    const result = await window.desktopApi.saveSvg({ svg, defaultName });
    if (result?.ok) {
      updateStatus(`saved ${result.path}`);
      return;
    }

    if (result?.canceled) {
      updateStatus("export canceled");
      return;
    }

    updateStatus(`export failed: ${result?.error || "unknown error"}`);
    return;
  }

  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = defaultName;
  link.click();
  URL.revokeObjectURL(url);
  updateStatus("saved via browser download fallback");
}

function wireEvents() {
  const liveControls = document.querySelectorAll(".controls input, .controls select");
  for (const control of liveControls) {
    control.addEventListener("input", () => {
      scheduleRender(false);
    });
    control.addEventListener("change", () => {
      scheduleRender(false);
    });
  }

  refs.btnNewSeed.addEventListener("click", () => {
    refs.seed.value = String(randomSeed());
    scheduleRender(true);
  });

  refs.btnRebuild.addEventListener("click", () => {
    scheduleRender(true);
  });

  refs.btnExport.addEventListener("click", () => {
    exportCurrent().catch((error) => {
      updateStatus(`export error: ${String(error.message || error)}`);
    });
  });

  window.addEventListener("resize", () => scheduleRender(false));
}

wireEvents();
render(true);