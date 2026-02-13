import { generateForm } from "./engine/form-engine.js";
import { buildStrokeScene } from "./engine/mark-engine.js";
import { extractMergedFaces } from "./engine/mesher.js";
import { buildExportStlFromGrid } from "./engine/mesh-export.js";
import { projectFaces } from "./engine/projection.js";
import { randomSeed } from "./engine/random.js";
import { buildExportSvg, buildPreviewSvg } from "./engine/svg-export.js";

const refs = {
  previewHost: document.getElementById("preview-host"),
  statusLine: document.getElementById("status-line"),
  seed: document.getElementById("seed"),
  btnGenerate: document.getElementById("btn-generate"),
  btnExportSvg: document.getElementById("btn-export-svg"),
  btnExportStl: document.getElementById("btn-export-stl")
};

const EXPORT_PROJECT_SLUG = (document.title || "sculpture-generator-desktop")
  .toLowerCase()
  .replace(/[^\w.-]+/g, "-")
  .replace(/^-+|-+$/g, "");
const exportNameState = {
  minuteStamp: "",
  countInMinute: 0
};

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatMinuteTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hour = pad2(date.getHours());
  const minute = pad2(date.getMinutes());
  return `${year}${month}${day}-${hour}${minute}`;
}

function makeDefaultExportName(extension) {
  const minuteStamp = formatMinuteTimestamp(new Date());
  if (exportNameState.minuteStamp !== minuteStamp) {
    exportNameState.minuteStamp = minuteStamp;
    exportNameState.countInMinute = 0;
  } else {
    exportNameState.countInMinute += 1;
  }

  const counter = exportNameState.countInMinute > 0
    ? `-${pad2(exportNameState.countInMinute)}`
    : "";
  return `${EXPORT_PROJECT_SLUG}-${minuteStamp}${counter}.${extension}`;
}

const FORM_DEFAULTS = {
  width: 10,
  depth: 10,
  height: 12,
  massCount: 4,
  carveCount: 5,
  bridgeCount: 3,
  towerCount: 3,
  terraceRate: 0.35,
  cantileverRate: 0.3,
  notchCount: 6,
  spliceCount: 4,
  verticalBias: 0.62,
  supportRatio: 0.2
};

const runtimeFormState = { ...FORM_DEFAULTS };

const viewState = {
  yawDeg: 45,
  pitchDeg: 0,
  orientation: null,
  zoom: 1,
  panX: 0,
  panY: 0,
  dragging: false,
  dragMode: "rotate",
  moved: false,
  pointerId: null,
  pointerButton: 0,
  downX: 0,
  downY: 0,
  lastX: 0,
  lastY: 0
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function dot3(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross3(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

function normalize3(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length
  };
}

function orthonormalizeMat3(m) {
  let ux = normalize3({ x: m[0], y: m[3], z: m[6] });
  const cy = { x: m[1], y: m[4], z: m[7] };
  const cyProj = dot3(cy, ux);
  let ty = {
    x: cy.x - ux.x * cyProj,
    y: cy.y - ux.y * cyProj,
    z: cy.z - ux.z * cyProj
  };

  if (Math.hypot(ty.x, ty.y, ty.z) < 1e-6) {
    const fallback = Math.abs(ux.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
    ty = cross3(fallback, ux);
  }

  let uy = normalize3(ty);
  let uz = normalize3(cross3(ux, uy));
  uy = normalize3(cross3(uz, ux));

  return [
    ux.x, uy.x, uz.x,
    ux.y, uy.y, uz.y,
    ux.z, uy.z, uz.z
  ];
}

function multiplyMat3(a, b) {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8]
  ];
}

function applyMat3(m, v) {
  return {
    x: m[0] * v.x + m[1] * v.y + m[2] * v.z,
    y: m[3] * v.x + m[4] * v.y + m[5] * v.z,
    z: m[6] * v.x + m[7] * v.y + m[8] * v.z
  };
}

function axisAngleToMat3(axis, angle) {
  const a = normalize3(axis);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  const { x, y, z } = a;

  return [
    t * x * x + c,
    t * x * y - s * z,
    t * x * z + s * y,
    t * y * x + s * z,
    t * y * y + c,
    t * y * z - s * x,
    t * z * x - s * y,
    t * z * y + s * x,
    t * z * z + c
  ];
}

function rotateXY(point, yawRadians) {
  const cos = Math.cos(yawRadians);
  const sin = Math.sin(yawRadians);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
    z: point.z
  };
}

function rotateScreenHorizontal(point, pitchRadians) {
  const axis = { x: Math.SQRT1_2, y: -Math.SQRT1_2, z: 0 };
  const dot = dot3(point, axis);
  const cross = cross3(axis, point);
  const cos = Math.cos(pitchRadians);
  const sin = Math.sin(pitchRadians);
  return {
    x: point.x * cos + cross.x * sin + axis.x * dot * (1 - cos),
    y: point.y * cos + cross.y * sin + axis.y * dot * (1 - cos),
    z: point.z * cos + cross.z * sin + axis.z * dot * (1 - cos)
  };
}

function orientationFromYawPitch(yawDeg, pitchDeg) {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  const ex = rotateScreenHorizontal(rotateXY({ x: 1, y: 0, z: 0 }, yaw), pitch);
  const ey = rotateScreenHorizontal(rotateXY({ x: 0, y: 1, z: 0 }, yaw), pitch);
  const ez = rotateScreenHorizontal(rotateXY({ x: 0, y: 0, z: 1 }, yaw), pitch);
  return [
    ex.x, ey.x, ez.x,
    ex.y, ey.y, ez.y,
    ex.z, ey.z, ez.z
  ];
}

function defaultOrientation() {
  return orientationFromYawPitch(45, 0);
}

viewState.orientation = defaultOrientation();

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
  const showOcclusionDebug = checked("show-occlusion-debug");
  const showOcclusionText = checked("show-occlusion-text");
  const showEdgePreMerge = checked("show-edge-premerge");
  const showEdgePostMerge = checked("show-edge-postmerge");
  const showEndpointClusters = checked("show-endpoint-clusters");
  const debugEnabled = showOcclusionDebug
    || showOcclusionText
    || showEdgePreMerge
    || showEdgePostMerge
    || showEndpointClusters;

  const form = {
    seed,
    width: clamp(integer("grid-width", runtimeFormState.width), 4, 30),
    depth: clamp(integer("grid-depth", runtimeFormState.depth), 4, 30),
    height: clamp(integer("grid-height", runtimeFormState.height), 4, 40),
    massCount: clamp(integer("mass-count", runtimeFormState.massCount), 1, 16),
    carveCount: clamp(integer("carve-count", runtimeFormState.carveCount), 0, 24),
    bridgeCount: clamp(integer("bridge-count", runtimeFormState.bridgeCount), 0, 12),
    towerCount: clamp(integer("tower-count", runtimeFormState.towerCount), 0, 20),
    terraceRate: clamp(numeric("terrace-rate", runtimeFormState.terraceRate), 0, 1),
    cantileverRate: clamp(numeric("cantilever-rate", runtimeFormState.cantileverRate), 0, 1),
    notchCount: clamp(integer("notch-count", runtimeFormState.notchCount), 0, 24),
    spliceCount: clamp(integer("splice-count", runtimeFormState.spliceCount), 0, 16),
    verticalBias: clamp(numeric("vertical-bias", runtimeFormState.verticalBias), 0, 1),
    supportRatio: clamp(numeric("support-ratio", runtimeFormState.supportRatio), 0, 1)
  };
  Object.assign(runtimeFormState, {
    width: form.width,
    depth: form.depth,
    height: form.height,
    massCount: form.massCount,
    carveCount: form.carveCount,
    bridgeCount: form.bridgeCount,
    towerCount: form.towerCount,
    terraceRate: form.terraceRate,
    cantileverRate: form.cantileverRate,
    notchCount: form.notchCount,
    spliceCount: form.spliceCount,
    verticalBias: form.verticalBias,
    supportRatio: form.supportRatio
  });

  return {
    seed,
    form,
    view: {
      yawDeg: viewState.yawDeg,
      pitchDeg: viewState.pitchDeg,
      orientation: viewState.orientation ? [...viewState.orientation] : defaultOrientation(),
      scale: 30
    },
    mark: {
      seed,
      occlusionDebug: debugEnabled,
      modeByFace: {
        top: "none",
        left: "none",
        right: "none"
      },
      hatchSpacing: 5,
      hatchAngle: 25,
      contourStep: 4,
      stippleSpacing: 6,
      maxStrokes: 7000,
      minSegment: 0.8
    },
    preview: {
      showFaces: checked("show-faces"),
      showOutline: checked("show-outline"),
      showInternal: checked("show-internal"),
      showMidtone: checked("show-midtone"),
      showDense: checked("show-dense"),
      showOcclusionDebug: showOcclusionDebug,
      showOcclusionText: showOcclusionText,
      showEdgePreMerge: showEdgePreMerge,
      showEdgePostMerge: showEdgePostMerge,
      showEndpointClusters: showEndpointClusters
    }
  };
}

function randomizeGeometryControls(seed) {
  const rng = randomSeedRng(seed);

  runtimeFormState.width = randomInt(rng, 8, 24);
  runtimeFormState.depth = randomInt(rng, 8, 24);
  runtimeFormState.height = randomInt(rng, 10, 34);
  runtimeFormState.massCount = randomInt(rng, 3, 12);
  runtimeFormState.carveCount = randomInt(rng, 2, 20);
  runtimeFormState.bridgeCount = randomInt(rng, 1, 10);
  runtimeFormState.towerCount = randomInt(rng, 1, 12);
  runtimeFormState.notchCount = randomInt(rng, 2, 18);
  runtimeFormState.spliceCount = randomInt(rng, 1, 12);
  runtimeFormState.terraceRate = randomFloat(rng, 0.08, 0.82, 2);
  runtimeFormState.cantileverRate = randomFloat(rng, 0.06, 0.68, 2);
  runtimeFormState.verticalBias = randomFloat(rng, 0.3, 0.9, 2);
  runtimeFormState.supportRatio = randomFloat(rng, 0.1, 0.6, 2);

  setControl("grid-width", runtimeFormState.width);
  setControl("grid-depth", runtimeFormState.depth);
  setControl("grid-height", runtimeFormState.height);
  setControl("mass-count", runtimeFormState.massCount);
  setControl("carve-count", runtimeFormState.carveCount);
  setControl("bridge-count", runtimeFormState.bridgeCount);
  setControl("tower-count", runtimeFormState.towerCount);
  setControl("notch-count", runtimeFormState.notchCount);
  setControl("splice-count", runtimeFormState.spliceCount);
  setControl("terrace-rate", runtimeFormState.terraceRate);
  setControl("cantilever-rate", runtimeFormState.cantileverRate);
  setControl("vertical-bias", runtimeFormState.verticalBias);
  setControl("support-ratio", runtimeFormState.supportRatio);
  updateValueBadges();
}

function setControl(id, value) {
  const element = document.getElementById(id);
  if (!element) {
    return;
  }
  element.value = String(value);
}

function randomSeedRng(seed) {
  let state = (Math.abs(Math.trunc(seed)) || 1) % 2147483647;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
}

function randomInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function randomFloat(rng, min, max, precision = 3) {
  const value = min + rng() * (max - min);
  return Number(value.toFixed(precision));
}

function formKey(settings) {
  return JSON.stringify(settings.form);
}

function modelPivot(rawFaces) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (const face of rawFaces || []) {
    for (const corner of face.corners || []) {
      minX = Math.min(minX, corner.x);
      minY = Math.min(minY, corner.y);
      minZ = Math.min(minZ, corner.z);
      maxX = Math.max(maxX, corner.x);
      maxY = Math.max(maxY, corner.y);
      maxZ = Math.max(maxZ, corner.z);
    }
  }

  if (!Number.isFinite(minX)) {
    return { x: 0, y: 0, z: 0 };
  }

  return {
    x: (minX + maxX) * 0.5,
    y: (minY + maxY) * 0.5,
    z: (minZ + maxZ) * 0.5
  };
}

const cache = {
  formKey: "",
  grid: null,
  rawFaces: [],
  scene: null,
  lastSettings: null,
  formRebuilt: false
};

function updateStatus(text) {
  refs.statusLine.textContent = text;
}

function buildScene(settings, forceFormRebuild = false, interactive = false) {
  const key = formKey(settings);
  let formRebuilt = false;

  if (forceFormRebuild || key !== cache.formKey) {
    const grid = generateForm(settings.form);
    cache.grid = grid;
    cache.rawFaces = extractMergedFaces(grid);
    cache.formKey = key;
    formRebuilt = true;
  }

  const pivot = modelPivot(cache.rawFaces);
  const view = { ...settings.view, pivot };
  const projectedFaces = projectFaces(cache.rawFaces, view, {
    fastOrder: false
  });
  cache.scene = buildStrokeScene(projectedFaces, settings.mark, {
    fastMode: interactive
  });
  cache.lastSettings = { ...settings, view };
  cache.formRebuilt = formRebuilt;

  return cache.scene;
}

function sceneBounds(scene) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const consume = (point) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  };

  for (const face of scene.faces || []) {
    for (const point of face.points || []) {
      consume(point);
    }
  }

  for (const layer of Object.values(scene.layers || {})) {
    for (const stroke of layer || []) {
      for (const point of stroke.points || []) {
        consume(point);
      }
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return {
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
}

function fitViewToScene(scene, viewportWidth, viewportHeight) {
  const bounds = sceneBounds(scene);
  if (!bounds) {
    viewState.zoom = 1;
    viewState.panX = 0;
    viewState.panY = 0;
    return;
  }

  const padding = 40;
  const fitWidth = Math.max(120, viewportWidth - padding * 2);
  const fitHeight = Math.max(90, viewportHeight - padding * 2);
  const fitZoom = Math.min(fitWidth / bounds.width, fitHeight / bounds.height);

  viewState.zoom = clamp(fitZoom * 0.5, 0.2, 6);
  viewState.panX = 0;
  viewState.panY = 0;
}

function render(forceFormRebuild = false, interactive = viewState.dragging) {
  try {
    const settings = readSettings();
    const scene = buildScene(settings, forceFormRebuild, interactive);
    const viewportWidth = Math.max(320, refs.previewHost.clientWidth || 0);
    const viewportHeight = Math.max(240, refs.previewHost.clientHeight || 0);

    if (cache.formRebuilt) {
      fitViewToScene(scene, viewportWidth, viewportHeight);
    }

    const viewport = {
      width: viewportWidth,
      height: viewportHeight,
      zoom: viewState.zoom,
      panX: viewState.panX,
      panY: viewState.panY,
      lockCenter: true
    };
    refs.previewHost.innerHTML = buildPreviewSvg(scene, settings.preview, viewport);

    let baseStatus = `faces ${scene.stats.faceCount} | strokes ${scene.stats.totalStrokes} | clipped ${scene.stats.clippedStrokes} | A ${scene.stats.outlineStrokes + scene.stats.internalStrokes} | B ${scene.stats.midtoneStrokes} | C ${scene.stats.denseStrokes}`;
    const segmentStats = scene.debug?.occlusion?.segmentStats;
    if (segmentStats) {
      baseStatus += ` | seg ${segmentStats.before}->${segmentStats.after} | micro ${segmentStats.removedMicro}`;
    }
    if (interactive) {
      baseStatus += " | fast";
    }
    if (!viewState.dragging) {
      updateStatus(baseStatus);
    }
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
    render(force, viewState.dragging);
  });
}

function updateValueBadges() {
  const badges = document.querySelectorAll(".value[data-for]");
  for (const badge of badges) {
    const id = badge.getAttribute("data-for");
    const input = id ? document.getElementById(id) : null;
    if (!input) {
      continue;
    }
    badge.textContent = input.value;
  }
}

function bindRotationControls() {
  const host = refs.previewHost;
  if (!host) {
    return;
  }

  host.style.cursor = "grab";
  host.style.touchAction = "none";

  host.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  const onPointerDown = (event) => {
    if (viewState.dragging) {
      return;
    }
    viewState.dragging = true;
    viewState.dragMode = event.shiftKey || event.button !== 0 ? "pan" : "rotate";
    viewState.moved = false;
    viewState.pointerId = event.pointerId;
    viewState.pointerButton = event.button;
    viewState.downX = event.clientX;
    viewState.downY = event.clientY;
    viewState.lastX = event.clientX;
    viewState.lastY = event.clientY;
    host.setPointerCapture(event.pointerId);
    host.style.cursor = "grabbing";
  };

  const onPointerMove = (event) => {
    if (!viewState.dragging || event.pointerId !== viewState.pointerId) {
      return;
    }
    const deltaX = event.clientX - viewState.lastX;
    const deltaY = event.clientY - viewState.lastY;
    viewState.lastX = event.clientX;
    viewState.lastY = event.clientY;
    if (Math.hypot(event.clientX - viewState.downX, event.clientY - viewState.downY) > 3) {
      viewState.moved = true;
    }
    if (viewState.dragMode === "pan") {
      viewState.panX += deltaX;
      viewState.panY += deltaY;
    } else {
      const yawStep = -deltaX * 0.0065;
      const pitchStep = -deltaY * 0.0065;
      const yawRotation = axisAngleToMat3({ x: 0, y: 0, z: 1 }, yawStep);
      const pitchRotation = axisAngleToMat3({ x: Math.SQRT1_2, y: -Math.SQRT1_2, z: 0 }, pitchStep);
      const base = viewState.orientation || defaultOrientation();
      const next = multiplyMat3(pitchRotation, multiplyMat3(yawRotation, base));
      viewState.orientation = orthonormalizeMat3(next);
    }
    scheduleRender(false);
  };

  const onPointerUp = (event) => {
    if (event.pointerId !== viewState.pointerId) {
      return;
    }
    if (!viewState.moved && viewState.pointerButton === 0) {
      viewState.yawDeg = 45;
      viewState.pitchDeg = 0;
      viewState.orientation = defaultOrientation();
    }
    viewState.dragging = false;
    viewState.pointerId = null;
    viewState.pointerButton = 0;
    host.releasePointerCapture(event.pointerId);
    host.style.cursor = "grab";
    scheduleRender(false);
  };

  const onPointerCancel = (event) => {
    if (event.pointerId !== viewState.pointerId) {
      return;
    }
    viewState.dragging = false;
    viewState.pointerId = null;
    viewState.pointerButton = 0;
    host.style.cursor = "grab";
    scheduleRender(false);
  };

  const onWheel = (event) => {
    event.preventDefault();
    const rect = host.getBoundingClientRect();
    const hostWidth = Math.max(1, rect.width);
    const hostHeight = Math.max(1, rect.height);
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const halfWidth = hostWidth * 0.5;
    const halfHeight = hostHeight * 0.5;
    const oldZoom = viewState.zoom;
    const factor = Math.exp(-event.deltaY * 0.0015);
    const newZoom = clamp(oldZoom * factor, 0.2, 6);

    const worldX = (mouseX - halfWidth - viewState.panX) / oldZoom;
    const worldY = (mouseY - halfHeight - viewState.panY) / oldZoom;

    viewState.zoom = newZoom;
    viewState.panX = mouseX - halfWidth - worldX * newZoom;
    viewState.panY = mouseY - halfHeight - worldY * newZoom;
    scheduleRender(false);
  };

  host.addEventListener("pointerdown", onPointerDown);
  host.addEventListener("pointermove", onPointerMove);
  host.addEventListener("pointerup", onPointerUp);
  host.addEventListener("pointercancel", onPointerCancel);
  host.addEventListener("wheel", onWheel, { passive: false });
  host.addEventListener("pointerleave", () => {
    if (!viewState.dragging) {
      host.style.cursor = "grab";
      return;
    }
    viewState.dragging = false;
    viewState.pointerId = null;
    viewState.pointerButton = 0;
    host.style.cursor = "grab";
    scheduleRender(false);
  });

  host.addEventListener("dblclick", () => {
    viewState.yawDeg = 45;
    viewState.pitchDeg = 0;
    viewState.orientation = defaultOrientation();
    viewState.zoom = 1;
    viewState.panX = 0;
    viewState.panY = 0;
    scheduleRender(false);
  });
}

function ensureRenderableScene() {
  if (!cache.scene || !cache.lastSettings) {
    render(true);
  }
}

async function exportCurrentSvg() {
  ensureRenderableScene();
  const settings = cache.lastSettings || readSettings();
  const svg = buildExportSvg(cache.scene, {
    title: "Iso Plot Export",
    seed: settings.seed
  });
  const defaultName = makeDefaultExportName("svg");

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

async function exportCurrentStl() {
  ensureRenderableScene();
  if (!cache.grid) {
    throw new Error("No voxel grid available for STL export.");
  }
  const defaultName = makeDefaultExportName("stl");
  const solidName = defaultName.replace(/\.stl$/i, "");
  const { stl, triangleCount, report } = buildExportStlFromGrid(cache.grid, {
    name: solidName,
    voxelSize: 1
  });
  const repairNote = report.repairedVoxels > 0 ? ` | repaired ${report.repairedVoxels}` : "";

  if (window.desktopApi?.saveStl) {
    const result = await window.desktopApi.saveStl({ stl, defaultName });
    if (result?.ok) {
      updateStatus(`saved ${result.path} | triangles ${triangleCount} | manifold ok${repairNote}`);
      return;
    }

    if (result?.canceled) {
      updateStatus("export canceled");
      return;
    }

    updateStatus(`export failed: ${result?.error || "unknown error"}`);
    return;
  }

  const blob = new Blob([stl], { type: "model/stl" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = defaultName;
  link.click();
  URL.revokeObjectURL(url);
  updateStatus(`saved via browser download fallback | triangles ${triangleCount} | manifold ok${repairNote}`);
}

function wireEvents() {
  const liveControls = document.querySelectorAll(".controls input, .controls select");
  for (const control of liveControls) {
    control.addEventListener("input", () => {
      updateValueBadges();
      scheduleRender(false);
    });
    control.addEventListener("change", () => {
      updateValueBadges();
      scheduleRender(false);
    });
  }

  refs.btnGenerate.addEventListener("click", () => {
    const nextSeed = randomSeed();
    refs.seed.value = String(nextSeed);
    randomizeGeometryControls(nextSeed);
    scheduleRender(true);
  });

  refs.btnExportSvg?.addEventListener("click", () => {
    exportCurrentSvg().catch((error) => {
      updateStatus(`export error: ${String(error.message || error)}`);
    });
  });

  refs.btnExportStl?.addEventListener("click", () => {
    exportCurrentStl().catch((error) => {
      updateStatus(`export error: ${String(error.message || error)}`);
    });
  });

  window.addEventListener("resize", () => scheduleRender(false));
}

wireEvents();
const startupSeed = randomSeed();
if (refs.seed) {
  refs.seed.value = String(startupSeed);
}
randomizeGeometryControls(startupSeed);
updateValueBadges();
bindRotationControls();
render(true);
