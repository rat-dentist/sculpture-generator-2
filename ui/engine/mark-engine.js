import {
  boundsFromPolygons,
  clipInfiniteLineToPolygon,
  clipSegmentToPolygon,
  distance,
  dot2,
  pointInPolygon,
  polygonCentroid,
  polylineLength,
  subtractSegmentByPolygon
} from "./geometry.js";
import { createRng } from "./random.js";
import { projectPoint } from "./projection.js";


function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalize3(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length
  };
}

function lightFromSunAngles(azimuthDeg, elevationDeg) {
  const azimuth = (azimuthDeg * Math.PI) / 180;
  const elevation = (clamp(elevationDeg, 1, 89) * Math.PI) / 180;
  const horizontal = Math.cos(elevation);

  return normalize3({
    x: Math.cos(azimuth) * horizontal,
    y: Math.sin(azimuth) * horizontal,
    z: -Math.sin(elevation)
  });
}

function angleFromVector(vector) {
  return (Math.atan2(vector.y, vector.x) * 180) / Math.PI;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function polygonBounds(polygons) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const polygon of polygons) {
    for (const point of polygon) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }

  return { minX, minY, maxX, maxY };
}

function smoothPolygon(points, iterations = 1) {
  let loop = points;

  for (let iter = 0; iter < iterations; iter += 1) {
    const next = [];
    for (let i = 0; i < loop.length; i += 1) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    loop = next;
  }

  return loop;
}

function contoursFromMask(mask, width, height, cellSize, originX, originY) {
  const nextByStart = new Map();

  function pointKey(x, y) {
    return `${x.toFixed(4)},${y.toFixed(4)}`;
  }

  function pushSegment(a, b) {
    const key = pointKey(a.x, a.y);
    if (!nextByStart.has(key)) {
      nextByStart.set(key, []);
    }
    nextByStart.get(key).push({ a, b });
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) {
        continue;
      }

      const x0 = originX + x * cellSize;
      const y0 = originY + y * cellSize;
      const x1 = x0 + cellSize;
      const y1 = y0 + cellSize;

      const upEmpty = y === 0 || !mask[(y - 1) * width + x];
      const rightEmpty = x === width - 1 || !mask[y * width + (x + 1)];
      const downEmpty = y === height - 1 || !mask[(y + 1) * width + x];
      const leftEmpty = x === 0 || !mask[y * width + (x - 1)];

      if (upEmpty) pushSegment({ x: x0, y: y0 }, { x: x1, y: y0 });
      if (rightEmpty) pushSegment({ x: x1, y: y0 }, { x: x1, y: y1 });
      if (downEmpty) pushSegment({ x: x1, y: y1 }, { x: x0, y: y1 });
      if (leftEmpty) pushSegment({ x: x0, y: y1 }, { x: x0, y: y0 });
    }
  }

  const loops = [];

  while (nextByStart.size) {
    const firstKey = nextByStart.keys().next().value;
    const firstList = nextByStart.get(firstKey);
    const firstSeg = firstList.pop();
    if (!firstList.length) {
      nextByStart.delete(firstKey);
    }

    const loop = [firstSeg.a, firstSeg.b];
    let current = firstSeg.b;

    while (true) {
      const key = pointKey(current.x, current.y);
      const list = nextByStart.get(key);
      if (!list || !list.length) {
        break;
      }
      const seg = list.pop();
      if (!list.length) {
        nextByStart.delete(key);
      }

      const nextPoint = seg.b;
      loop.push(nextPoint);
      current = nextPoint;

      if (Math.abs(current.x - loop[0].x) < 1e-4 && Math.abs(current.y - loop[0].y) < 1e-4) {
        break;
      }
    }

    if (loop.length >= 4) {
      loops.push(smoothPolygon(loop.slice(0, -1), 1));
    }
  }

  return loops;
}


function buildShadowSilhouette(polygons) {
  if (!polygons.length) {
    return [];
  }

  const bounds = polygonBounds(polygons);
  const cellSize = 1.2;
  const pad = 3;
  const width = Math.max(8, Math.ceil((bounds.maxX - bounds.minX) / cellSize) + pad * 2);
  const height = Math.max(8, Math.ceil((bounds.maxY - bounds.minY) / cellSize) + pad * 2);
  const originX = bounds.minX - pad * cellSize;
  const originY = bounds.minY - pad * cellSize;
  const mask = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const point = {
        x: originX + (x + 0.5) * cellSize,
        y: originY + (y + 0.5) * cellSize
      };

      for (const polygon of polygons) {
        if (pointInPolygon(point, polygon)) {
          mask[y * width + x] = 1;
          break;
        }
      }
    }
  }

  return contoursFromMask(mask, width, height, cellSize, originX, originY);
}

function applyAtmosphericFade(segments, driftDir, controls, seed, sampleCount) {
  if (!segments.length) {
    return [];
  }

  const rng = createRng(seed);
  const driftLength = Math.hypot(driftDir.x, driftDir.y) || 1;
  const driftUnit = { x: driftDir.x / driftLength, y: driftDir.y / driftLength };
  const mids = segments.map((segment) => ({
    along: dot2({
      x: (segment[0].x + segment[1].x) * 0.5,
      y: (segment[0].y + segment[1].y) * 0.5
    }, driftUnit),
    segment
  }));

  let minAlong = Number.POSITIVE_INFINITY;
  for (const item of mids) {
    minAlong = Math.min(minAlong, item.along);
  }

  const filtered = [];
  const strength = Math.max(0.05, controls.shadowStrength || 1);
  const fadeStart = Math.max(0, controls.shadowFadeStart || 40);
  const fadeLength = Math.max(1, controls.shadowFadeLength || 80);

  for (const item of mids) {
    const distanceAlong = item.along - minAlong;
    let keep = Math.min(1, strength / Math.max(1, sampleCount));

    if ((controls.shadowMode || 'hard') === 'atmospheric') {
      const fadeT = smoothstep(fadeStart, fadeStart + fadeLength, distanceAlong);
      keep *= 1 - fadeT;
    }

    if (rng() <= keep) {
      filtered.push(item.segment);
    }
  }

  return filtered;
}

function edgeKey(a, b) {
  const p0 = `${a.x.toFixed(3)},${a.y.toFixed(3)}`;
  const p1 = `${b.x.toFixed(3)},${b.y.toFixed(3)}`;
  return p0 < p1 ? `${p0}|${p1}` : `${p1}|${p0}`;
}

function collectVisibleEdges(faces) {
  const map = new Map();

  for (const face of faces) {
    for (let i = 0; i < face.points.length; i += 1) {
      const a = face.points[i];
      const b = face.points[(i + 1) % face.points.length];
      const key = edgeKey(a, b);

      const current = map.get(key);
      if (current) {
        current.count += 1;
        current.depth = Math.max(current.depth, face.depth);
        continue;
      }

      map.set(key, {
        a,
        b,
        count: 1,
        depth: face.depth
      });
    }
  }

  return map;
}

function resolveAngle(faceType, baseAngle) {
  if (faceType === "top") {
    return baseAngle;
  }

  if (faceType === "left") {
    return baseAngle + 34;
  }

  return baseAngle - 34;
}

function generateHatchSegments(polygon, angleDeg, spacing) {
  const angle = (angleDeg * Math.PI) / 180;
  const direction = { x: Math.cos(angle), y: Math.sin(angle) };
  const normal = { x: -Math.sin(angle), y: Math.cos(angle) };

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const point of polygon) {
    const projection = dot2(point, normal);
    min = Math.min(min, projection);
    max = Math.max(max, projection);
  }

  const segments = [];
  for (let projection = min - spacing; projection <= max + spacing; projection += spacing) {
    const linePoint = {
      x: normal.x * projection,
      y: normal.y * projection
    };

    const clipped = clipInfiniteLineToPolygon(linePoint, direction, polygon);
    if (clipped) {
      segments.push(clipped);
    }
  }

  return segments;
}


function mergeIntervals(intervals) {
  if (!intervals.length) {
    return [];
  }

  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const merged = [sorted[0].slice()];

  for (let i = 1; i < sorted.length; i += 1) {
    const [start, end] = sorted[i];
    const current = merged[merged.length - 1];

    if (start <= current[1] + 1e-4) {
      current[1] = Math.max(current[1], end);
      continue;
    }

    merged.push([start, end]);
  }

  return merged;
}

function generateUnionHatchSegments(polygons, angleDeg, spacing, rawSegments = null) {
  if (!polygons.length) {
    return [];
  }

  const angle = (angleDeg * Math.PI) / 180;
  const direction = { x: Math.cos(angle), y: Math.sin(angle) };
  const normal = { x: -Math.sin(angle), y: Math.cos(angle) };

  let minProjection = Number.POSITIVE_INFINITY;
  let maxProjection = Number.NEGATIVE_INFINITY;

  for (const polygon of polygons) {
    for (const point of polygon) {
      const projection = dot2(point, normal);
      minProjection = Math.min(minProjection, projection);
      maxProjection = Math.max(maxProjection, projection);
    }
  }

  if (!Number.isFinite(minProjection) || !Number.isFinite(maxProjection)) {
    return [];
  }

  const segments = [];

  for (let projection = minProjection - spacing; projection <= maxProjection + spacing; projection += spacing) {
    const linePoint = {
      x: normal.x * projection,
      y: normal.y * projection
    };

    const intervals = [];

    for (const polygon of polygons) {
      const clipped = clipInfiniteLineToPolygon(linePoint, direction, polygon);
      if (!clipped) {
        continue;
      }

      if (rawSegments) {
        rawSegments.push(clipped);
      }

      let t0 = dot2(clipped[0], direction);
      let t1 = dot2(clipped[1], direction);
      if (t1 < t0) {
        [t0, t1] = [t1, t0];
      }
      intervals.push([t0, t1]);
    }

    const mergedIntervals = mergeIntervals(intervals);
    for (const [t0, t1] of mergedIntervals) {
      segments.push([
        { x: linePoint.x + direction.x * t0, y: linePoint.y + direction.y * t0 },
        { x: linePoint.x + direction.x * t1, y: linePoint.y + direction.y * t1 }
      ]);
    }
  }

  return segments;
}

function makeDot(center, radius, steps = 8) {
  const points = [];

  for (let i = 0; i <= steps; i += 1) {
    const t = (Math.PI * 2 * i) / steps;
    points.push({
      x: center.x + Math.cos(t) * radius,
      y: center.y + Math.sin(t) * radius
    });
  }

  return points;
}

function generateStippleDots(polygon, spacing, seed) {
  const rng = createRng(seed);
  const bounds = boundsFromPolygons([polygon]);
  const lines = [];
  const radius = Math.max(0.4, spacing * 0.18);

  for (let y = bounds.minY; y <= bounds.maxY; y += spacing) {
    for (let x = bounds.minX; x <= bounds.maxX; x += spacing) {
      const jitterX = (rng() - 0.5) * spacing * 0.5;
      const jitterY = (rng() - 0.5) * spacing * 0.5;
      const point = { x: x + jitterX, y: y + jitterY };

      if (!pointInPolygon(point, polygon)) {
        continue;
      }

      lines.push(makeDot(point, radius));
    }
  }

  return lines;
}

function generateContourSegments(polygon, step, seed) {
  const rng = createRng(seed);
  const centroid = polygonCentroid(polygon);
  const biasPoint = polygon[Math.floor(rng() * polygon.length)] || centroid;
  const anchor = {
    x: centroid.x * 0.64 + biasPoint.x * 0.36,
    y: centroid.y * 0.64 + biasPoint.y * 0.36
  };

  let maxRadius = 0;
  for (const point of polygon) {
    maxRadius = Math.max(maxRadius, distance(anchor, point));
  }

  const segments = [];

  for (let radius = step; radius <= maxRadius + step; radius += step) {
    const samples = Math.max(24, Math.round((Math.PI * 2 * radius) / 5));

    for (let i = 0; i < samples; i += 1) {
      const t0 = (Math.PI * 2 * i) / samples;
      const t1 = (Math.PI * 2 * (i + 1)) / samples;
      const start = {
        x: anchor.x + Math.cos(t0) * radius,
        y: anchor.y + Math.sin(t0) * radius
      };
      const end = {
        x: anchor.x + Math.cos(t1) * radius,
        y: anchor.y + Math.sin(t1) * radius
      };

      const clipped = clipSegmentToPolygon(start, end, polygon);
      for (const segment of clipped) {
        segments.push(segment);
      }
    }
  }

  return segments;
}

function projectShadowPolygons(rawFaces, view, light) {
  if (!rawFaces?.length) {
    return [];
  }

  const polygons = [];

  for (const face of rawFaces) {
    const polygon = face.corners.map((corner) => {
      const t = light.z < -1e-6 ? corner.z / -light.z : 0;
      const groundPoint = {
        x: corner.x + light.x * t,
        y: corner.y + light.y * t,
        z: 0
      };
      const projected = projectPoint(groundPoint, view);
      return { x: projected.x, y: projected.y };
    });

    if (polygon.length >= 3) {
      polygons.push(polygon);
    }
  }

  return polygons;
}

function projectContactFootprint(rawFaces, view) {
  if (!rawFaces?.length) {
    return [];
  }

  const footprint = [];

  for (const face of rawFaces) {
    if (face.normal.z >= 0) {
      continue;
    }

    if (!face.corners.every((corner) => Math.abs(corner.z) < 1e-5)) {
      continue;
    }

    footprint.push(
      face.corners.map((corner) => {
        const projected = projectPoint({ x: corner.x, y: corner.y, z: 0 }, view);
        return { x: projected.x, y: projected.y };
      })
    );
  }

  return footprint;
}

function projectedLightDirection(view, light) {
  const base = projectPoint({ x: 0, y: 0, z: 0 }, view);
  const drift = projectPoint({ x: light.x, y: light.y, z: 0 }, view);
  return {
    x: drift.x - base.x,
    y: drift.y - base.y
  };
}

function addStroke(layers, layerName, points, closed, controls, budget, depth = Number.NEGATIVE_INFINITY) {
  if (!points || points.length < 2) {
    return;
  }

  if (polylineLength(points) < controls.minSegment) {
    return;
  }

  if (budget.used >= controls.maxStrokes) {
    budget.clipped += 1;
    return;
  }

  layers[layerName].push({ points, closed, depth });
  budget.used += 1;
}

function clipStrokeByOccluders(stroke, occluders) {
  if (stroke.closed || stroke.points.length < 2 || !Number.isFinite(stroke.depth)) {
    return [stroke];
  }

  const visible = [];

  for (let i = 1; i < stroke.points.length; i += 1) {
    let segments = [[stroke.points[i - 1], stroke.points[i]]];

    for (const occluder of occluders) {
      if (occluder.depth <= stroke.depth + 1e-4) {
        continue;
      }

      const nextSegments = [];
      for (const [start, end] of segments) {
        const remain = subtractSegmentByPolygon(start, end, occluder.points);
        for (const seg of remain) {
          nextSegments.push(seg);
        }
      }

      segments = nextSegments;
      if (!segments.length) {
        break;
      }
    }

    for (const [start, end] of segments) {
      visible.push({ points: [start, end], closed: false, depth: stroke.depth });
    }
  }

  return visible;
}

function occludeLayer(strokes, faces) {
  const clipped = [];
  const occluders = [...faces].sort((a, b) => b.depth - a.depth);

  for (const stroke of strokes) {
    const kept = clipStrokeByOccluders(stroke, occluders);
    for (const item of kept) {
      clipped.push(item);
    }
  }

  return clipped;
}

function stripDepth(layer) {
  return layer.map(({ points, closed }) => ({ points, closed }));
}

export function buildStrokeScene(faces, controls, options = {}) {
  const layers = {
    shadow: [],
    outline: [],
    internal: [],
    midtone: [],
    dense: [],
    debugProjected: [],
    debugUnion: [],
    debugHatchRaw: []
  };

  const budget = {
    used: 0,
    clipped: 0,
    maxStrokes: controls.maxStrokes
  };

  const shadowDebug = Boolean(controls.shadowDebug);
  const lightDir = lightFromSunAngles(controls.sunAzimuth ?? 315, controls.sunElevation ?? 24);
  const lightScreenDir = projectedLightDirection(options.view || { yawDeg: 45, scale: 30 }, lightDir);

  if (controls.groundShadow) {
    const projectedPolygons = projectShadowPolygons(options.rawFaces, options.view, lightDir);
    const contactPolygons = projectContactFootprint(options.rawFaces, options.view);
    const allShadowPolygons = [...projectedPolygons, ...contactPolygons];
    const silhouettePolygons = buildShadowSilhouette(allShadowPolygons);

    const driftAngle = angleFromVector(lightScreenDir);
    const hatchAngle = controls.shadowHatchMode === "parallel" ? driftAngle : driftAngle + 90;
    const baseSpacing = Math.max(1.2, controls.hatchSpacing * 0.82);
    const shadowStrength = clamp(controls.shadowStrength ?? 1, 0.1, 3);
    const shadowMode = controls.shadowMode || "hard";
    const sampleCount = shadowMode === "atmospheric" ? Math.max(1, Math.round(1 + clamp(controls.shadowSoftness ?? 0, 0, 1) * 10)) : 1;

    const rawHatch = shadowDebug ? [] : null;
    const finalShadowLines = [];
    const sampleRng = createRng((controls.seed || 1) + 8117);

    for (let sample = 0; sample < sampleCount; sample += 1) {
      let sampleLight = lightDir;

      if (shadowMode === "atmospheric" && sampleCount > 1) {
        const jitterAz = (sampleRng() - 0.5) * 16 * clamp(controls.shadowSoftness ?? 0, 0, 1);
        const jitterEl = (sampleRng() - 0.5) * 8 * clamp(controls.shadowSoftness ?? 0, 0, 1);
        sampleLight = lightFromSunAngles((controls.sunAzimuth ?? 315) + jitterAz, (controls.sunElevation ?? 24) + jitterEl);
      }

      const sampleProjected = projectShadowPolygons(options.rawFaces, options.view, sampleLight);
      const sampleAll = [...sampleProjected, ...contactPolygons];
      const sampleSilhouette = buildShadowSilhouette(sampleAll);
      const sampleRaw = shadowDebug ? [] : rawHatch;
      const sampleLines = generateUnionHatchSegments(sampleSilhouette, hatchAngle, baseSpacing / shadowStrength, sampleRaw);
      const faded = applyAtmosphericFade(sampleLines, lightScreenDir, { ...controls, shadowMode, shadowStrength }, (controls.seed || 1) + sample * 191, sampleCount);

      for (const line of faded) {
        finalShadowLines.push(line);
      }

      if (shadowDebug && sampleRaw) {
        for (const line of sampleRaw) {
          addStroke(layers, "debugHatchRaw", line, false, controls, budget);
        }
      }
    }

    for (const line of finalShadowLines) {
      addStroke(layers, "shadow", line, false, controls, budget);
    }

    if (shadowDebug) {
      for (const polygon of allShadowPolygons) {
        for (let i = 0; i < polygon.length; i += 1) {
          const a = polygon[i];
          const b = polygon[(i + 1) % polygon.length];
          addStroke(layers, "debugProjected", [a, b], false, controls, budget);
        }
      }

      for (const polygon of silhouettePolygons) {
        for (let i = 0; i < polygon.length; i += 1) {
          const a = polygon[i];
          const b = polygon[(i + 1) % polygon.length];
          addStroke(layers, "debugUnion", [a, b], false, controls, budget);
        }
      }
    }
  }

  const edges = collectVisibleEdges(faces);
  for (const edge of edges.values()) {
    const layer = edge.count > 1 ? "internal" : "outline";
    addStroke(layers, layer, [edge.a, edge.b], false, controls, budget, edge.depth);
  }

  for (const face of faces) {
    const mode = controls.modeByFace[face.faceType] || "none";

    if (mode === "none") {
      continue;
    }

    if (mode === "hatch" || mode === "crosshatch") {
      const angleA = resolveAngle(face.faceType, controls.hatchAngle);
      const hatchA = generateHatchSegments(face.points, angleA, controls.hatchSpacing);
      for (const line of hatchA) {
        addStroke(layers, "midtone", line, false, controls, budget, face.depth);
      }

      if (mode === "crosshatch") {
        const hatchB = generateHatchSegments(face.points, angleA + 90, controls.hatchSpacing * 1.1);
        for (const line of hatchB) {
          addStroke(layers, "dense", line, false, controls, budget, face.depth);
        }
      }

      continue;
    }

    if (mode === "stipple") {
      const dots = generateStippleDots(face.points, controls.stippleSpacing, controls.seed + face.id * 13);
      for (const dot of dots) {
        addStroke(layers, "dense", dot, true, controls, budget, face.depth);
      }
      continue;
    }

    if (mode === "contour") {
      const contours = generateContourSegments(face.points, controls.contourStep, controls.seed + face.id * 29);
      for (const segment of contours) {
        addStroke(layers, "dense", segment, false, controls, budget, face.depth);
      }
    }
  }

  const occluded = {
    shadow: layers.shadow,
    outline: occludeLayer(layers.outline, faces),
    internal: occludeLayer(layers.internal, faces),
    midtone: occludeLayer(layers.midtone, faces),
    dense: occludeLayer(layers.dense, faces),
    debugProjected: layers.debugProjected,
    debugUnion: layers.debugUnion,
    debugHatchRaw: layers.debugHatchRaw
  };

  return {
    faces,
    layers: {
      shadow: stripDepth(occluded.shadow),
      outline: stripDepth(occluded.outline),
      internal: stripDepth(occluded.internal),
      midtone: stripDepth(occluded.midtone),
      dense: stripDepth(occluded.dense),
      debugProjected: stripDepth(occluded.debugProjected),
      debugUnion: stripDepth(occluded.debugUnion),
      debugHatchRaw: stripDepth(occluded.debugHatchRaw)
    },
    stats: {
      faceCount: faces.length,
      totalStrokes: budget.used,
      clippedStrokes: budget.clipped,
      shadowStrokes: occluded.shadow.length,
      outlineStrokes: occluded.outline.length,
      internalStrokes: occluded.internal.length,
      midtoneStrokes: occluded.midtone.length,
      denseStrokes: occluded.dense.length
    },
    debug: {
      shadowEnabled: shadowDebug,
      lightDirWorld: lightDir,
      lightDirScreen: lightScreenDir
    }
  };
}
