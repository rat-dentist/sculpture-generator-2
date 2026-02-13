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

function sceneCenter(scene) {
  const bounds = boundsFromPolygons(collectPolygons(scene));
  return {
    x: (bounds.minX + bounds.maxX) * 0.5,
    y: (bounds.minY + bounds.maxY) * 0.5
  };
}

function faceFill(face) {
  const key = face.shadeKey || face.faceType;
  if (key === "z_pos") {
    return "#e2e2e2";
  }
  if (key === "x_pos") {
    return "#cfcfcf";
  }
  if (key === "y_pos") {
    return "#bdbdbd";
  }
  if (key === "x_neg") {
    return "#a7a7a7";
  }
  if (key === "y_neg") {
    return "#939393";
  }
  if (key === "z_neg") {
    return "#7d7d7d";
  }
  if (key === "top") {
    return "#dddddd";
  }
  if (key === "left") {
    return "#bcbcbc";
  }
  if (key === "right") {
    return "#969696";
  }
  return "#d0d0d0";
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

export function buildPreviewSvg(scene, toggles, viewport = {}) {
  const lockCenter = Boolean(viewport.lockCenter);
  const center = lockCenter ? { x: 0, y: 0 } : sceneCenter(scene);
  const dx = -center.x;
  const dy = -center.y;
  const width = Math.max(320, Number(viewport.width) || 900);
  const height = Math.max(240, Number(viewport.height) || 700);
  const zoom = Math.max(0.2, Number(viewport.zoom) || 1);
  const panX = Number(viewport.panX) || 0;
  const panY = Number(viewport.panY) || 0;
  const tx = width * 0.5 + panX;
  const ty = height * 0.5 + panY;

  const facePolygons = scene.faces
    .map((face) => `<polygon points="${polygonMarkup(face.points, dx, dy)}" fill="${faceFill(face)}" />`)
    .join("\n");

  const outlinePath = pathFromStrokes(scene.layers.outline, dx, dy);
  const internalPath = pathFromStrokes(scene.layers.internal, dx, dy);
  const midtonePath = pathFromStrokes(scene.layers.midtone, dx, dy);
  const densePath = pathFromStrokes(scene.layers.dense, dx, dy);
  const debugBoxesPath = pathFromStrokes(scene.debug?.occlusion?.faceBoxes || [], dx, dy);
  const debugSilhouettePath = pathFromStrokes(scene.debug?.occlusion?.edgeSilhouette || [], dx, dy);
  const debugInternalPath = pathFromStrokes(scene.debug?.occlusion?.edgeInternal || [], dx, dy);
  const debugPreMergePath = pathFromStrokes(scene.debug?.occlusion?.edgePreMerge || [], dx, dy);
  const debugPostMergePath = pathFromStrokes(scene.debug?.occlusion?.edgePostMerge || [], dx, dy);
  const debugClustersPath = pathFromStrokes(scene.debug?.occlusion?.endpointClusters || [], dx, dy);
  const debugPassPath = pathFromStrokes(scene.debug?.occlusion?.samplePass || [], dx, dy);
  const debugFailPath = pathFromStrokes(scene.debug?.occlusion?.sampleFail || [], dx, dy);
  const debugLabels = (scene.debug?.occlusion?.faceLabels || [])
    .map((label) => `<text x="${format(label.x + dx)}" y="${format(label.y + dy)}" fill="#1f2937" font-size="8" font-family="monospace">${label.text}</text>`)
    .join("");
  const depthPreview = scene.debug?.occlusion?.depthPreview?.[0];
  let depthPreviewMarkup = "";
  if (toggles.showOcclusionDebug && depthPreview) {
    const cellSize = 2.2;
    const panelPad = 6;
    const panelW = depthPreview.w * cellSize + panelPad * 2;
    const panelH = depthPreview.h * cellSize + panelPad * 2 + 10;
    const panelX = Math.max(8, width - panelW - 8);
    const panelY = 8;
    const cells = depthPreview.cells
      .map((cell) => {
        const g = Math.round(cell.t * 255);
        return `<rect x="${format(panelX + panelPad + cell.x * cellSize)}" y="${format(panelY + panelPad + cell.y * cellSize)}" width="${format(cellSize)}" height="${format(cellSize)}" fill="rgb(${g},${g},${g})" />`;
      })
      .join("");
    depthPreviewMarkup = `<g id="debug_depth_preview"><rect x="${format(panelX)}" y="${format(panelY)}" width="${format(panelW)}" height="${format(panelH)}" fill="#ffffff" fill-opacity="0.85" stroke="#111827" stroke-width="0.6" /><text x="${format(panelX + panelPad)}" y="${format(panelY + panelH - 3)}" fill="#111827" font-size="7" font-family="monospace">depth</text>${cells}</g>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${format(width)} ${format(height)}" preserveAspectRatio="xMidYMid meet">
  <rect x="0" y="0" width="${format(width)}" height="${format(height)}" fill="#f8f5ee" />
  <g transform="translate(${format(tx)} ${format(ty)}) scale(${format(zoom)})">
  ${toggles.showFaces ? `<g id="faces" stroke="none">${facePolygons}</g>` : ""}
  ${toggles.showOutline ? `<path d="${outlinePath}" fill="none" stroke="#121212" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" />` : ""}
  ${toggles.showInternal ? `<path d="${internalPath}" fill="none" stroke="#707070" stroke-width="0.72" stroke-linecap="round" stroke-linejoin="round" />` : ""}
  ${toggles.showMidtone ? `<path d="${midtonePath}" fill="none" stroke="#3d3d3d" stroke-width="0.56" stroke-linecap="butt" stroke-linejoin="round" />` : ""}
  ${toggles.showDense ? `<path d="${densePath}" fill="none" stroke="#191919" stroke-width="0.48" stroke-linecap="butt" stroke-linejoin="round" />` : ""}
  ${toggles.showOcclusionDebug && debugBoxesPath ? `<path d="${debugBoxesPath}" fill="none" stroke="#2563eb" stroke-width="0.45" stroke-dasharray="2 2" />` : ""}
  ${toggles.showOcclusionDebug && debugSilhouettePath ? `<path d="${debugSilhouettePath}" fill="none" stroke="#15803d" stroke-width="0.9" />` : ""}
  ${toggles.showOcclusionDebug && debugInternalPath ? `<path d="${debugInternalPath}" fill="none" stroke="#dc2626" stroke-width="0.9" />` : ""}
  ${toggles.showEdgePreMerge && debugPreMergePath ? `<path d="${debugPreMergePath}" fill="none" stroke="#f59e0b" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round" />` : ""}
  ${toggles.showEdgePostMerge && debugPostMergePath ? `<path d="${debugPostMergePath}" fill="none" stroke="#0f766e" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" />` : ""}
  ${toggles.showEndpointClusters && debugClustersPath ? `<path d="${debugClustersPath}" fill="#7c3aed" fill-opacity="0.85" stroke="none" />` : ""}
  ${toggles.showOcclusionDebug && debugPassPath ? `<path d="${debugPassPath}" fill="#16a34a" fill-opacity="0.75" stroke="none" />` : ""}
  ${toggles.showOcclusionDebug && debugFailPath ? `<path d="${debugFailPath}" fill="#dc2626" fill-opacity="0.75" stroke="none" />` : ""}
  ${toggles.showOcclusionText ? debugLabels : ""}
  </g>
  ${depthPreviewMarkup}
</svg>`;
}

export function buildExportSvg(scene, meta) {
  const margin = 16;
  const metrics = sceneMetrics(scene, margin);
  const dx = metrics.offsetX;
  const dy = metrics.offsetY;

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
  <g id="pen_a_outline" fill="none" stroke="#111111" stroke-width="1.2" stroke-linecap="butt" stroke-linejoin="round">
    <path d="${outlinePath}" />
    <path d="${internalPath}" stroke-width="0.65" stroke="#444444" />
  </g>
  <g id="pen_b_midtone" fill="none" stroke="#222222" stroke-width="0.52" stroke-linecap="butt" stroke-linejoin="round">
    <path d="${midtonePath}" />
  </g>
  <g id="pen_c_dense" fill="none" stroke="#181818" stroke-width="0.44" stroke-linecap="butt" stroke-linejoin="round">
    <path d="${densePath}" />
  </g>
</svg>`;
}
