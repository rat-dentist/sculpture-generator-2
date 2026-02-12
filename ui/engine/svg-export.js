import { boundsFromPolygons } from "./geometry.js";

function format(value) {
  return Number(value.toFixed(3));
}

function collectPolygons(scene) {
  const polygons = [];

  for (const face of scene.faces) {
    polygons.push(face.points);
  }

  for (const layer of Object.values(scene.layers)) {
    for (const stroke of layer) {
      polygons.push(stroke.points);
    }
  }

  return polygons;
}

function sceneMetrics(scene, margin) {
  const bounds = boundsFromPolygons(collectPolygons(scene));

  const width = bounds.width + margin * 2;
  const height = bounds.height + margin * 2;
  const offsetX = margin - bounds.minX;
  const offsetY = margin - bounds.minY;

  return {
    width,
    height,
    offsetX,
    offsetY
  };
}

function polygonMarkup(points, dx, dy) {
  return points
    .map((point) => `${format(point.x + dx)},${format(point.y + dy)}`)
    .join(" ");
}

function pathFromStrokes(strokes, dx, dy) {
  const fragments = [];

  for (const stroke of strokes) {
    if (!stroke.points.length) {
      continue;
    }

    let fragment = `M ${format(stroke.points[0].x + dx)} ${format(stroke.points[0].y + dy)}`;
    for (let i = 1; i < stroke.points.length; i += 1) {
      fragment += ` L ${format(stroke.points[i].x + dx)} ${format(stroke.points[i].y + dy)}`;
    }

    if (stroke.closed) {
      fragment += " Z";
    }

    fragments.push(fragment);
  }

  return fragments.join(" ");
}


function debugLightArrow(scene, dx, dy) {
  if (!scene.debug?.shadowEnabled || !scene.debug.lightDirScreen) {
    return "";
  }

  const dir = scene.debug.lightDirScreen;
  const length = Math.hypot(dir.x, dir.y) || 1;
  const ux = dir.x / length;
  const uy = dir.y / length;
  const start = { x: 24 + dx, y: 24 + dy };
  const end = { x: start.x + ux * 56, y: start.y + uy * 56 };
  const left = { x: end.x - ux * 10 - uy * 4, y: end.y - uy * 10 + ux * 4 };
  const right = { x: end.x - ux * 10 + uy * 4, y: end.y - uy * 10 - ux * 4 };

  return `<g id="debug_light_arrow" fill="none" stroke="#2046d4" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"><path d="M ${format(start.x)} ${format(start.y)} L ${format(end.x)} ${format(end.y)} M ${format(left.x)} ${format(left.y)} L ${format(end.x)} ${format(end.y)} L ${format(right.x)} ${format(right.y)}" /></g>`;
}

export function buildPreviewSvg(scene, toggles) {
  const margin = 28;
  const metrics = sceneMetrics(scene, margin);
  const dx = metrics.offsetX;
  const dy = metrics.offsetY;

  const facePolygons = scene.faces
    .map((face) => `<polygon points="${polygonMarkup(face.points, dx, dy)}" />`)
    .join("\n");

  const shadowPath = pathFromStrokes(scene.layers.shadow || [], dx, dy);
  const debugProjectedPath = pathFromStrokes(scene.layers.debugProjected || [], dx, dy);
  const debugUnionPath = pathFromStrokes(scene.layers.debugUnion || [], dx, dy);
  const debugHatchRawPath = pathFromStrokes(scene.layers.debugHatchRaw || [], dx, dy);
  const outlinePath = pathFromStrokes(scene.layers.outline, dx, dy);
  const internalPath = pathFromStrokes(scene.layers.internal, dx, dy);
  const midtonePath = pathFromStrokes(scene.layers.midtone, dx, dy);
  const densePath = pathFromStrokes(scene.layers.dense, dx, dy);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${format(metrics.width)} ${format(metrics.height)}" preserveAspectRatio="xMidYMid meet">
  <rect x="0" y="0" width="${format(metrics.width)}" height="${format(metrics.height)}" fill="#f8f5ee" />
  ${shadowPath ? `<path d="${shadowPath}" fill="none" stroke="#8f8d86" stroke-width="0.5" stroke-linecap="round" stroke-linejoin="round" />` : ""}
  ${scene.debug?.shadowEnabled && debugHatchRawPath ? `<path d="${debugHatchRawPath}" fill="none" stroke="#2c8f2c" stroke-width="0.35" stroke-linecap="round" stroke-linejoin="round" />` : ""}
  ${scene.debug?.shadowEnabled && debugProjectedPath ? `<path d="${debugProjectedPath}" fill="none" stroke="#c43a3a" stroke-width="0.5" stroke-linecap="round" stroke-linejoin="round" />` : ""}
  ${scene.debug?.shadowEnabled && debugUnionPath ? `<path d="${debugUnionPath}" fill="none" stroke="#3056d8" stroke-width="0.65" stroke-linecap="round" stroke-linejoin="round" />` : ""}
  ${debugLightArrow(scene, dx, dy)}
  ${toggles.showFaces ? `<g id="faces" fill="#fcfbf7" stroke="none">${facePolygons}</g>` : ""}
  ${toggles.showOutline ? `<path d="${outlinePath}" fill="none" stroke="#121212" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" />` : ""}
  ${toggles.showInternal ? `<path d="${internalPath}" fill="none" stroke="#707070" stroke-width="0.72" stroke-linecap="round" stroke-linejoin="round" />` : ""}
  ${toggles.showMidtone ? `<path d="${midtonePath}" fill="none" stroke="#3d3d3d" stroke-width="0.56" stroke-linecap="round" stroke-linejoin="round" />` : ""}
  ${toggles.showDense ? `<path d="${densePath}" fill="none" stroke="#191919" stroke-width="0.48" stroke-linecap="round" stroke-linejoin="round" />` : ""}
</svg>`;
}

export function buildExportSvg(scene, meta) {
  const margin = 16;
  const metrics = sceneMetrics(scene, margin);
  const dx = metrics.offsetX;
  const dy = metrics.offsetY;

  const shadowPath = pathFromStrokes(scene.layers.shadow || [], dx, dy);
  const debugProjectedPath = pathFromStrokes(scene.layers.debugProjected || [], dx, dy);
  const debugUnionPath = pathFromStrokes(scene.layers.debugUnion || [], dx, dy);
  const debugHatchRawPath = pathFromStrokes(scene.layers.debugHatchRaw || [], dx, dy);
  const outlinePath = pathFromStrokes(scene.layers.outline, dx, dy);
  const internalPath = pathFromStrokes(scene.layers.internal, dx, dy);
  const midtonePath = pathFromStrokes(scene.layers.midtone, dx, dy);
  const densePath = pathFromStrokes(scene.layers.dense, dx, dy);

  const stamp = new Date().toISOString();
  const title = meta?.title || "Iso Plot Export";
  const seed = meta?.seed ?? "unknown";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${format(metrics.width)}" height="${format(metrics.height)}" viewBox="0 0 ${format(metrics.width)} ${format(metrics.height)}">
  <title>${title}</title>
  <desc>Generated ${stamp} | seed ${seed}</desc>
  <g id="ground_shadow" fill="none" stroke="#999999" stroke-width="0.48" stroke-linecap="round" stroke-linejoin="round">
    <path d="${shadowPath}" />
  </g>
  <g id="pen_a_outline" fill="none" stroke="#111111" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="${outlinePath}" />
    <path d="${internalPath}" stroke-width="0.65" stroke="#444444" />
  </g>
  <g id="pen_b_midtone" fill="none" stroke="#222222" stroke-width="0.52" stroke-linecap="round" stroke-linejoin="round">
    <path d="${midtonePath}" />
  </g>
  <g id="pen_c_dense" fill="none" stroke="#181818" stroke-width="0.44" stroke-linecap="round" stroke-linejoin="round">
    <path d="${densePath}" />
  </g>
</svg>`;
}