import { boundsFromPolygons, pointInPolygon } from "./geometry.js";
import { createRng } from "./random.js";
import { toneIndexForFace } from "./projection.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function roundDebug(value, digits = 4) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function sampleStops(stops, t) {
  if (!Array.isArray(stops) || !stops.length) {
    return 0;
  }
  if (stops.length === 1) {
    return stops[0];
  }
  const scaled = clamp(t, 0, 1) * (stops.length - 1);
  const i0 = Math.floor(scaled);
  const i1 = Math.min(stops.length - 1, i0 + 1);
  const local = scaled - i0;
  return lerp(stops[i0], stops[i1], local);
}

const TONE_CALIBRATION_DEFAULTS = {
  toneGamma: 1,
  toneContrast: 1,
  blackPoint: 0,
  whitePoint: 1,
  minInk: 0
};

function resolveToneCalibration(controls, styleCalibration = {}) {
  return {
    toneGamma: clamp(Number(styleCalibration.toneGamma ?? controls.toneGamma ?? TONE_CALIBRATION_DEFAULTS.toneGamma), 0.25, 3),
    toneContrast: clamp(Number(styleCalibration.toneContrast ?? controls.toneContrast ?? TONE_CALIBRATION_DEFAULTS.toneContrast), 0.2, 3),
    blackPoint: clamp(Number(styleCalibration.blackPoint ?? controls.blackPoint ?? TONE_CALIBRATION_DEFAULTS.blackPoint), 0, 0.98),
    whitePoint: clamp(Number(styleCalibration.whitePoint ?? controls.whitePoint ?? TONE_CALIBRATION_DEFAULTS.whitePoint), 0.02, 1),
    minInk: clamp(Number(styleCalibration.minInk ?? controls.minInk ?? TONE_CALIBRATION_DEFAULTS.minInk), 0, 0.85)
  };
}

function calibrateTone01(tone01, calibration) {
  const lo = Math.min(calibration.blackPoint, calibration.whitePoint - 1e-5);
  const hi = Math.max(calibration.whitePoint, lo + 1e-5);
  let t = clamp((tone01 - lo) / (hi - lo), 0, 1);
  t = Math.pow(t, 1 / calibration.toneGamma);
  t = clamp((t - 0.5) * calibration.toneContrast + 0.5, 0, 1);
  return clamp(t * (1 - calibration.minInk), 0, 1);
}

function styleSeed(controls, face, toneIndex, salt = 0) {
  return (controls.seed | 0) + face.id * 193 + toneIndex * 17 + salt;
}

function polygonArea(points) {
  if (!points || points.length < 3) {
    return 0;
  }

  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const j = (i + 1) % points.length;
    sum += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  return Math.abs(sum) * 0.5;
}

function polygonCentroid(points) {
  if (!points || !points.length) {
    return { x: 0, y: 0 };
  }

  let sumX = 0;
  let sumY = 0;
  for (const point of points) {
    sumX += point.x;
    sumY += point.y;
  }

  return {
    x: sumX / points.length,
    y: sumY / points.length
  };
}

function distance3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function faceMetrics(face) {
  const bounds = boundsFromPolygons([face.points || []]);
  const width = Math.max(1e-6, bounds.width);
  const height = Math.max(1e-6, bounds.height);
  const minDim = Math.max(1e-6, Math.min(width, height));
  const diag = Math.max(1e-6, Math.hypot(width, height));
  const area = Math.max(1e-6, polygonArea(face.points || []));

  return {
    bounds,
    width,
    height,
    minDim,
    diag,
    area,
    centroid: polygonCentroid(face.points || [])
  };
}

function faceFrame(face, controls = {}) {
  const points = face.points || [];
  const bounds = boundsFromPolygons([points]);
  const alignToFace = Boolean(controls.shaderAlignToFace);
  let origin = points[0] ? { x: points[0].x, y: points[0].y } : { x: 0, y: 0 };
  let uX = 1;
  let uY = 0;
  let vX = 0;
  let vY = 1;
  let uLen2D = 1;
  let vLen2D = 1;

  if (alignToFace) {
    const p1 = points[1] || points[0] || { x: 1, y: 0 };
    const plast = points[points.length - 1] || points[0] || { x: 0, y: 1 };

    uX = p1.x - origin.x;
    uY = p1.y - origin.y;
    vX = plast.x - origin.x;
    vY = plast.y - origin.y;

    if (face.visibleMask) {
      uX = face.visibleMask.uX;
      uY = face.visibleMask.uY;
      vX = face.visibleMask.vX;
      vY = face.visibleMask.vY;
    }

    uLen2D = Math.hypot(uX, uY);
    vLen2D = Math.hypot(vX, vY);
  }

  if (!alignToFace || uLen2D < 1e-6 || vLen2D < 1e-6) {
    origin = { x: bounds.minX, y: bounds.minY };
    uX = Math.max(1e-5, bounds.width);
    uY = 0;
    vX = 0;
    vY = Math.max(1e-5, bounds.height);
    uLen2D = Math.max(1e-5, Math.abs(uX));
    vLen2D = Math.max(1e-5, Math.abs(vY));
  }

  const worldCorners = face.worldCorners || [];
  const worldU = worldCorners.length >= 2
    ? Math.max(1e-3, distance3(worldCorners[0], worldCorners[1]))
    : Math.max(1, Math.sqrt(Math.max(1, face.area || 1)));
  const worldV = worldCorners.length >= 4
    ? Math.max(1e-3, distance3(worldCorners[0], worldCorners[worldCorners.length - 1]))
    : Math.max(1, (face.area || 1) / worldU);

  return {
    origin,
    uX,
    uY,
    vX,
    vY,
    uLen2D,
    vLen2D,
    worldU,
    worldV,
    uDir: { x: uX / Math.max(1e-6, uLen2D), y: uY / Math.max(1e-6, uLen2D) },
    vDir: { x: vX / Math.max(1e-6, vLen2D), y: vY / Math.max(1e-6, vLen2D) }
  };
}

function pointFromUv(frame, u, v) {
  return {
    x: frame.origin.x + frame.uX * u + frame.vX * v,
    y: frame.origin.y + frame.uY * u + frame.vY * v
  };
}

function sampleVisibleMask(face, point) {
  if (!face?.useVisibleMaskForShader) {
    return pointInPolygon(point, face.points || []);
  }

  const mask = face.visibleMask;
  if (!mask) {
    return pointInPolygon(point, face.points || []);
  }

  const dx = point.x - mask.origin.x;
  const dy = point.y - mask.origin.y;
  const u = (dx * mask.vY - dy * mask.vX) * mask.invDet;
  const v = (mask.uX * dy - mask.uY * dx) * mask.invDet;

  if (u < 0 || u > 1 || v < 0 || v > 1) {
    return false;
  }

  const col = clamp(Math.floor(u * mask.cols), 0, mask.cols - 1);
  const row = clamp(Math.floor(v * mask.rows), 0, mask.rows - 1);
  return mask.cells[row * mask.cols + col] === 1;
}

function makeSegment(a, b) {
  return [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
}

function densityControl(controls) {
  return clamp(Number(controls.shaderDensity ?? 1), 0.02, 6);
}

function hash2(row, col, seed = 0) {
  const x = (row | 0) * 73856093;
  const y = (col | 0) * 19349663;
  const z = (seed | 0) * 83492791;
  const value = (x ^ y ^ z) >>> 0;
  return (value % 100000) / 100000;
}

function uniformlyDownsample(candidates, maxCount) {
  if (!Array.isArray(candidates) || candidates.length <= maxCount || maxCount <= 0) {
    return candidates || [];
  }

  const out = [];
  const step = candidates.length / maxCount;
  let cursor = 0;
  for (let i = 0; i < maxCount; i += 1) {
    const idx = Math.min(candidates.length - 1, Math.floor(cursor));
    out.push(candidates[idx]);
    cursor += step;
  }
  return out;
}

function addCandidate(candidates, a, b, maxStrokes) {
  if (candidates.length >= maxStrokes) {
    return;
  }
  candidates.push(makeSegment(a, b));
}

function strokeCapForFace(controls, calibratedTone01, metrics, styleWeight = 1) {
  const hardCap = Math.max(16, Math.round(controls.faceStrokeBudget ?? controls.maxStrokes ?? 240));
  const darkness = 1 - clamp(calibratedTone01, 0, 1);
  const densityScale = densityControl(controls);
  const toneGain = lerp(0.92, 2.36, darkness);
  const areaGain = clamp(Math.sqrt(metrics.area) / 18, 0.72, 2.2);
  const cap = Math.round(hardCap * styleWeight * toneGain * areaGain * Math.pow(densityScale, 0.72));
  return clamp(cap, 12, hardCap);
}

function spacingScale(controls) {
  const coarse = controls.shaderCoarse ? 1.16 : 1;
  const userScale = clamp(Number(controls.shaderSpacingScale ?? 1), 0.42, 1.9);
  const densityScale = densityControl(controls);
  return coarse * userScale / densityScale;
}

function projectionSpan(points, angleDeg) {
  const angle = (angleDeg * Math.PI) / 180;
  const nx = -Math.sin(angle);
  const ny = Math.cos(angle);

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    const p = point.x * nx + point.y * ny;
    min = Math.min(min, p);
    max = Math.max(max, p);
  }

  return Math.max(0, max - min);
}

function chooseHatchAngle(face, baseAngle, gap, minLines) {
  const spanA = projectionSpan(face.points, baseAngle);
  const spanB = projectionSpan(face.points, baseAngle + 90);
  const estA = spanA / Math.max(1e-5, gap);
  const estB = spanB / Math.max(1e-5, gap);

  if (estA < minLines && estB > estA * 1.16) {
    return baseAngle + 90;
  }
  return baseAngle;
}

function tightenGapForCoverage(face, angleDeg, gap, minLines) {
  if (minLines <= 1) {
    return gap;
  }

  const span = projectionSpan(face.points, angleDeg);
  if (span <= 1e-5) {
    return gap;
  }

  const maxGap = span / minLines;
  return Math.max(0.42, Math.min(gap, maxGap));
}

function hatchCandidates(face, metrics, angleDeg, gap, maxStrokes, jitter = 0, rng = null) {
  const angle = (angleDeg * Math.PI) / 180;
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  const normal = { x: -Math.sin(angle), y: Math.cos(angle) };

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const point of face.points || []) {
    const p = point.x * normal.x + point.y * normal.y;
    min = Math.min(min, p);
    max = Math.max(max, p);
  }

  const candidates = [];
  const halfLen = Math.max(metrics.diag * 1.1, 8);
  const span = Math.max(1e-6, max - min);
  const lineCount = Math.max(1, Math.min(maxStrokes, Math.round(span / Math.max(1e-5, gap)) + 1));

  for (let i = 0; i < lineCount; i += 1) {
    const t = lineCount === 1 ? 0.5 : i / (lineCount - 1);
    let projection = min + span * t;
    if (lineCount > 3 && jitter > 0 && rng) {
      projection += (rng() - 0.5) * gap * jitter;
    }

    const centerProjection = metrics.centroid.x * normal.x + metrics.centroid.y * normal.y;
    const linePoint = {
      x: metrics.centroid.x + normal.x * (projection - centerProjection),
      y: metrics.centroid.y + normal.y * (projection - centerProjection)
    };

    const a = {
      x: linePoint.x - dir.x * halfLen,
      y: linePoint.y - dir.y * halfLen
    };
    const b = {
      x: linePoint.x + dir.x * halfLen,
      y: linePoint.y + dir.y * halfLen
    };

    addCandidate(candidates, a, b, maxStrokes);
  }

  return candidates;
}

function gridForFace(face, controls, stepWorld, maxDim = 120) {
  const frame = faceFrame(face, controls);
  const scaledStepWorld = clamp(stepWorld * spacingScale(controls), 0.08, 8.5);
  const cols = clamp(Math.round(frame.worldU / scaledStepWorld), 3, maxDim);
  const rows = clamp(Math.round(frame.worldV / scaledStepWorld), 3, maxDim);

  return {
    frame,
    cols,
    rows,
    cellU: 1 / cols,
    cellV: 1 / rows,
    cellScreen: Math.max(0.2, Math.min(frame.uLen2D / cols, frame.vLen2D / rows))
  };
}

function pointFromCenterOffset(center, dir, amount) {
  return {
    x: center.x + dir.x * amount,
    y: center.y + dir.y * amount
  };
}

function emitCellMark(candidates, center, frame, size, toneLevel, maxStrokes) {
  const s = Math.max(0.08, size);
  addCandidate(
    candidates,
    pointFromCenterOffset(center, frame.uDir, -s),
    pointFromCenterOffset(center, frame.uDir, s),
    maxStrokes
  );

  if (toneLevel >= 2) {
    addCandidate(
      candidates,
      pointFromCenterOffset(center, frame.vDir, -s),
      pointFromCenterOffset(center, frame.vDir, s),
      maxStrokes
    );
  }

  if (toneLevel >= 3) {
    const d1 = { x: (frame.uDir.x + frame.vDir.x) * Math.SQRT1_2, y: (frame.uDir.y + frame.vDir.y) * Math.SQRT1_2 };
    addCandidate(candidates, pointFromCenterOffset(center, d1, -s * 0.88), pointFromCenterOffset(center, d1, s * 0.88), maxStrokes);
  }

  if (toneLevel >= 4) {
    const d2 = { x: (frame.uDir.x - frame.vDir.x) * Math.SQRT1_2, y: (frame.uDir.y - frame.vDir.y) * Math.SQRT1_2 };
    addCandidate(candidates, pointFromCenterOffset(center, d2, -s * 0.88), pointFromCenterOffset(center, d2, s * 0.88), maxStrokes);
  }

  if (toneLevel >= 5) {
    addCandidate(candidates, pointFromCenterOffset(center, frame.uDir, -s * 0.52), pointFromCenterOffset(center, frame.uDir, s * 0.52), maxStrokes);
    addCandidate(candidates, pointFromCenterOffset(center, frame.vDir, -s * 0.52), pointFromCenterOffset(center, frame.vDir, s * 0.52), maxStrokes);
  }
}

function emitDitherMark(candidates, center, frame, size, toneLevel, row, col, maxStrokes) {
  const s = Math.max(0.06, size);
  const d1 = { x: (frame.uDir.x + frame.vDir.x) * Math.SQRT1_2, y: (frame.uDir.y + frame.vDir.y) * Math.SQRT1_2 };
  const d2 = { x: (frame.uDir.x - frame.vDir.x) * Math.SQRT1_2, y: (frame.uDir.y - frame.vDir.y) * Math.SQRT1_2 };
  const mode = (row + col) & 3;
  const primary = mode === 0
    ? frame.uDir
    : mode === 1
      ? frame.vDir
      : mode === 2
        ? d1
        : d2;
  const secondary = mode % 2 === 0 ? frame.vDir : frame.uDir;

  addCandidate(
    candidates,
    pointFromCenterOffset(center, primary, -s),
    pointFromCenterOffset(center, primary, s),
    maxStrokes
  );

  if (toneLevel >= 2) {
    addCandidate(
      candidates,
      pointFromCenterOffset(center, secondary, -s * 0.66),
      pointFromCenterOffset(center, secondary, s * 0.66),
      maxStrokes
    );
  }

  if (toneLevel >= 4) {
    addCandidate(
      candidates,
      pointFromCenterOffset(center, d1, -s * 0.58),
      pointFromCenterOffset(center, d1, s * 0.58),
      maxStrokes
    );
    addCandidate(
      candidates,
      pointFromCenterOffset(center, d2, -s * 0.58),
      pointFromCenterOffset(center, d2, s * 0.58),
      maxStrokes
    );
  }
}

const ASCII_GLYPHS = {
  ".": [[0, -0.04, 0, 0.04]],
  ":": [[0, -0.34, 0, -0.22], [0, 0.22, 0, 0.34]],
  "-": [[-0.46, 0, 0.46, 0]],
  "=": [[-0.46, -0.18, 0.46, -0.18], [-0.46, 0.18, 0.46, 0.18]],
  "+": [[-0.46, 0, 0.46, 0], [0, -0.5, 0, 0.5]],
  "x": [[-0.4, -0.4, 0.4, 0.4], [-0.4, 0.4, 0.4, -0.4]],
  "*": [[-0.46, 0, 0.46, 0], [0, -0.5, 0, 0.5], [-0.34, -0.34, 0.34, 0.34], [-0.34, 0.34, 0.34, -0.34]],
  "H": [[-0.38, -0.5, -0.38, 0.5], [0.38, -0.5, 0.38, 0.5], [-0.38, 0, 0.38, 0]],
  "#": [[-0.26, -0.5, -0.26, 0.5], [0.26, -0.5, 0.26, 0.5], [-0.5, -0.18, 0.5, -0.18], [-0.5, 0.18, 0.5, 0.18]],
  "%": [[-0.46, -0.5, 0.46, 0.5], [-0.42, 0.3, -0.24, 0.48], [0.24, -0.48, 0.42, -0.3]],
  "O": [[-0.38, -0.45, 0.38, -0.45], [0.38, -0.45, 0.38, 0.45], [0.38, 0.45, -0.38, 0.45], [-0.38, 0.45, -0.38, -0.45]],
  "&": [[-0.34, -0.48, 0.1, -0.48], [0.1, -0.48, 0.34, -0.24], [0.34, -0.24, 0.34, 0.2], [0.34, 0.2, 0.08, 0.48], [0.08, 0.48, -0.26, 0.48], [-0.26, 0.48, -0.42, 0.24], [-0.42, 0.24, -0.42, -0.08], [-0.42, -0.08, 0.06, 0.16], [0.06, 0.16, 0.36, 0.48]],
  "@": [[-0.44, 0.02, -0.24, 0.44], [-0.24, 0.44, 0.24, 0.44], [0.24, 0.44, 0.44, 0.16], [0.44, 0.16, 0.16, -0.04], [0.16, -0.04, 0.3, -0.24], [0.3, -0.24, 0.1, -0.4], [0.1, -0.4, -0.2, -0.34], [-0.2, -0.34, -0.36, -0.1], [-0.36, -0.1, -0.3, 0.2], [-0.3, 0.2, -0.06, 0.24], [-0.06, 0.24, 0.08, 0.06], [-0.06, 0.1, 0.2, 0.1], [0.2, 0.1, 0.2, -0.12]]
};

let ASCII_GLYPH_COVERAGE_CACHE = null;

function pointToSegmentDistance(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  if (len2 <= 1e-9) {
    return Math.hypot(px - ax, py - ay);
  }
  const t = clamp(((px - ax) * vx + (py - ay) * vy) / len2, 0, 1);
  const cx = ax + vx * t;
  const cy = ay + vy * t;
  return Math.hypot(px - cx, py - cy);
}

function estimateGlyphCoverageBySampling(glyph, size = 24, stroke = 0.1) {
  const segments = ASCII_GLYPHS[glyph] || [];
  if (!segments.length) {
    return 0;
  }

  let hits = 0;
  const total = size * size;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = ((x + 0.5) / size - 0.5) * 1.2;
      const py = ((y + 0.5) / size - 0.5) * 1.2;
      let on = false;
      for (const segment of segments) {
        const d = pointToSegmentDistance(px, py, segment[0], segment[1], segment[2], segment[3]);
        if (d <= stroke) {
          on = true;
          break;
        }
      }
      if (on) {
        hits += 1;
      }
    }
  }
  return hits / total;
}

function estimateGlyphCoverageCanvas(glyph) {
  if (typeof document === "undefined") {
    return null;
  }

  try {
    const size = 24;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }

    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = "#000";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2.2;

    const segments = ASCII_GLYPHS[glyph] || [];
    for (const segment of segments) {
      const ax = (segment[0] * 0.84 + 0.5) * size;
      const ay = (segment[1] * 0.84 + 0.5) * size;
      const bx = (segment[2] * 0.84 + 0.5) * size;
      const by = (segment[3] * 0.84 + 0.5) * size;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }

    const pixels = ctx.getImageData(0, 0, size, size).data;
    let count = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] > 0) {
        count += 1;
      }
    }
    return count / (size * size);
  } catch {
    return null;
  }
}

function sortedAsciiGlyphCoverage() {
  if (ASCII_GLYPH_COVERAGE_CACHE) {
    return ASCII_GLYPH_COVERAGE_CACHE;
  }

  const entries = Object.keys(ASCII_GLYPHS).map((glyph) => {
    const byCanvas = estimateGlyphCoverageCanvas(glyph);
    const coverage = Number.isFinite(byCanvas) ? byCanvas : estimateGlyphCoverageBySampling(glyph);
    return { glyph, coverage };
  });

  entries.sort((a, b) => a.coverage - b.coverage);
  ASCII_GLYPH_COVERAGE_CACHE = entries;
  return entries;
}

function glyphIndexForDarkness(darkness, inkBias = 0.2) {
  const table = sortedAsciiGlyphCoverage();
  const target = clamp(darkness + inkBias, 0, 1);
  let bestIndex = 0;
  let bestDelta = Math.abs(target - table[0].coverage);

  for (let i = 1; i < table.length; i += 1) {
    const delta = Math.abs(target - table[i].coverage);
    if (delta < bestDelta) {
      bestIndex = i;
      bestDelta = delta;
    }
  }

  return bestIndex;
}

function glyphForDarkness(darkness, inkBias = 0.2) {
  const table = sortedAsciiGlyphCoverage();
  return table[glyphIndexForDarkness(darkness, inkBias)].glyph;
}

function glyphBlendForDarkness(darkness, inkBias = 0.2) {
  const table = sortedAsciiGlyphCoverage();
  const target = clamp(darkness + inkBias, 0, 1);

  let hi = 0;
  while (hi < table.length && table[hi].coverage < target) {
    hi += 1;
  }

  if (hi <= 0) {
    return { glyphA: table[0].glyph, glyphB: table[0].glyph, mix: 0 };
  }
  if (hi >= table.length) {
    const tail = table[table.length - 1].glyph;
    return { glyphA: tail, glyphB: tail, mix: 0 };
  }

  const lo = hi - 1;
  const low = table[lo];
  const high = table[hi];
  const span = Math.max(1e-6, high.coverage - low.coverage);
  const mix = clamp((target - low.coverage) / span, 0, 1);
  return {
    glyphA: low.glyph,
    glyphB: high.glyph,
    mix
  };
}

function emitGlyph(candidates, center, frame, glyph, size, maxStrokes) {
  const segments = ASCII_GLYPHS[glyph] || ASCII_GLYPHS["."];
  const s = Math.max(0.08, size);

  for (const segment of segments) {
    if (candidates.length >= maxStrokes) {
      break;
    }

    const ax = segment[0] * s;
    const ay = segment[1] * s;
    const bx = segment[2] * s;
    const by = segment[3] * s;

    const a = {
      x: center.x + frame.uDir.x * ax + frame.vDir.x * ay,
      y: center.y + frame.uDir.y * ax + frame.vDir.y * ay
    };
    const b = {
      x: center.x + frame.uDir.x * bx + frame.vDir.x * by,
      y: center.y + frame.uDir.y * bx + frame.vDir.y * by
    };

    addCandidate(candidates, a, b, maxStrokes);
  }
}

function makeResult(candidates, cellsTested = 0, meta = {}) {
  return {
    strokes: candidates,
    candidates,
    stats: {
      cellsTested,
      emittedPreClip: candidates.length,
      emittedPostClip: candidates.length
    },
    meta
  };
}

function ensureMinimumCandidates(result, face, toneIndex) {
  if ((result.strokes?.length || 0) > 0) {
    return result;
  }

  const center = polygonCentroid(face.points || []);
  const size = toneIndex <= 0 ? 0.34 : 0.45 + toneIndex * 0.2;
  result.strokes = result.strokes || [];
  result.strokes.push(makeSegment(
    { x: center.x - size, y: center.y },
    { x: center.x + size, y: center.y }
  ));
  result.candidates = result.strokes;
  result.stats.emittedPreClip = result.strokes.length;
  result.stats.emittedPostClip = result.strokes.length;
  return result;
}

function stableSideBucket(face) {
  if (face?.shadeKey === "x_pos" || face?.shadeKey === "y_neg") {
    return "right";
  }
  if (face?.shadeKey === "y_pos" || face?.shadeKey === "x_neg") {
    return "left";
  }
  return face?.faceType || "left";
}

function baseHatchAngle(face) {
  const side = stableSideBucket(face);
  if (side === "left") {
    return 28;
  }
  if (side === "right") {
    return -28;
  }
  return 0;
}

function linesStyle(face, toneIndex, faceMeta, rng, controls) {
  const metrics = faceMetrics(face);
  const darkness = faceMeta.darkness;
  const toneLevel = clamp(Math.round(darkness * 5), 0, 5);
  const cap = strokeCapForFace(controls, faceMeta.calibratedTone, metrics, 1.44);
  const spacingByDarkness = [2.8, 2.25, 1.78, 1.42, 1.12, 0.86];
  const minLinesByDarkness = [12, 16, 22, 30, 40, 56];

  let spacing = sampleStops(spacingByDarkness, darkness) * spacingScale(controls);
  spacing = clamp(spacing, 0.42, metrics.diag * 0.7);

  const minLines = Math.round(sampleStops(minLinesByDarkness, darkness));
  const rawAngle = baseHatchAngle(face);
  const angle = chooseHatchAngle(face, rawAngle, spacing, minLines);
  spacing = tightenGapForCoverage(face, angle, spacing, minLines);

  const candidates = hatchCandidates(face, metrics, angle, spacing, cap, 0.07, rng);
  return ensureMinimumCandidates(makeResult(candidates, 0, {
    spacing,
    tone: toneLevel,
    diag: metrics.diag,
    calibratedTone: faceMeta.calibratedTone,
    linesMetrics: {
      face_id: face.id,
      projected_area_2d: roundDebug(metrics.area),
      min_dimension_2d: roundDebug(metrics.minDim),
      shade_value: roundDebug(faceMeta.calibratedTone),
      spacing: roundDebug(spacing),
      line_count: candidates.length,
      stroke_width: roundDebug(Math.max(0.05, Number(controls.shaderPenWidth ?? 0.56)))
    }
  }), face, toneLevel);
}

function crosshatchStyle(face, toneIndex, faceMeta, rng, controls) {
  const metrics = faceMetrics(face);
  const darkness = faceMeta.darkness;
  const toneLevel = clamp(Math.round(darkness * 5), 0, 5);
  const cap = strokeCapForFace(controls, faceMeta.calibratedTone, metrics, 1.66);
  const spacingByDarkness = [3.3, 2.7, 2.15, 1.7, 1.35, 1.05];
  const minLinesByDarkness = [10, 14, 18, 26, 36, 48];

  let spacingA = clamp(sampleStops(spacingByDarkness, darkness) * spacingScale(controls), 0.45, metrics.diag * 0.7);
  const minLinesA = Math.round(sampleStops(minLinesByDarkness, darkness));
  const angleA = chooseHatchAngle(face, baseHatchAngle(face), spacingA, minLinesA);
  spacingA = tightenGapForCoverage(face, angleA, spacingA, minLinesA);

  const candidates = hatchCandidates(face, metrics, angleA, spacingA, Math.round(cap * 0.62), 0.08, rng);

  if (darkness >= 0.32 && candidates.length < cap) {
    let spacingB = clamp(spacingA * 1.05, 0.45, metrics.diag * 0.6);
    const minLinesB = Math.max(4, Math.round(minLinesA * 0.78));
    const angleB = chooseHatchAngle(face, angleA + 90, spacingB, minLinesB);
    spacingB = tightenGapForCoverage(face, angleB, spacingB, minLinesB);
    candidates.push(...hatchCandidates(face, metrics, angleB, spacingB, cap - candidates.length, 0.07, rng));
  }

  if (darkness >= 0.66 && candidates.length < cap) {
    let spacingC = clamp(spacingA * 1.34, 0.52, metrics.diag * 0.75);
    const minLinesC = Math.max(3, Math.round(minLinesA * 0.44));
    const angleC = chooseHatchAngle(face, angleA + 45, spacingC, minLinesC);
    spacingC = tightenGapForCoverage(face, angleC, spacingC, minLinesC);
    candidates.push(...hatchCandidates(face, metrics, angleC, spacingC, cap - candidates.length, 0.04, rng));
  }

  return ensureMinimumCandidates(makeResult(candidates.slice(0, cap), 0, { spacing: spacingA, tone: toneLevel, diag: metrics.diag, calibratedTone: faceMeta.calibratedTone }), face, toneLevel);
}

function stippleStyle(face, toneIndex, faceMeta, _rng, controls) {
  const metrics = faceMetrics(face);
  const darkness = faceMeta.darkness;
  const toneLevel = clamp(Math.round(darkness * 5), 0, 5);
  const cap = strokeCapForFace(controls, faceMeta.calibratedTone, metrics, 2.28);
  const grid = gridForFace(face, controls, sampleStops([0.86, 0.76, 0.68, 0.6, 0.52, 0.44], darkness), 520);
  const density = sampleStops([0.38, 0.52, 0.66, 0.78, 0.9, 0.98], darkness);

  const minDist = Math.max(0.08, grid.cellScreen * 0.38);
  const hashStep = Math.max(minDist, 0.18);
  const hash = new Map();
  const points = [];
  const candidates = [];
  let cellsTested = 0;

  const hashKey = (x, y) => `${Math.floor(x / hashStep)},${Math.floor(y / hashStep)}`;

  const canPlace = (p) => {
    const hx = Math.floor(p.x / hashStep);
    const hy = Math.floor(p.y / hashStep);

    for (let oy = -1; oy <= 1; oy += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        const list = hash.get(`${hx + ox},${hy + oy}`);
        if (!list) {
          continue;
        }
        for (const idx of list) {
          const other = points[idx];
          if (Math.hypot(other.x - p.x, other.y - p.y) < minDist) {
            return false;
          }
        }
      }
    }
    return true;
  };

  const emitCap = Math.min(120000, Math.max(cap * 4, cap + 2400));
  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      if (candidates.length >= emitCap) {
        continue;
      }

      const u = (col + 0.5) * grid.cellU;
      const v = (row + 0.5) * grid.cellV;
      const base = pointFromUv(grid.frame, u, v);
      if (!sampleVisibleMask(face, base)) {
        continue;
      }

      cellsTested += 1;
      if (hash2(row, col, 71) > density) {
        continue;
      }

      const jitter = 0.36;
      const ju = (hash2(row, col, 181) - 0.5) * grid.cellU * jitter;
      const jv = (hash2(row, col, 281) - 0.5) * grid.cellV * jitter;
      const point = pointFromUv(grid.frame, clamp(u + ju, 0, 1), clamp(v + jv, 0, 1));
      if (!sampleVisibleMask(face, point) || !canPlace(point)) {
        continue;
      }

      const idx = points.length;
      points.push(point);
      const key = hashKey(point.x, point.y);
      if (!hash.has(key)) {
        hash.set(key, []);
      }
      hash.get(key).push(idx);

      const dashTone = toneLevel >= 4 ? toneLevel : Math.max(1, toneLevel - 1);
      emitCellMark(candidates, point, grid.frame, grid.cellScreen * 0.18, dashTone, emitCap);
      if (toneLevel >= 4 && candidates.length < emitCap) {
        const angle = hash2(row, col, 991) * Math.PI;
        const dir = { x: Math.cos(angle), y: Math.sin(angle) };
        const dash = Math.max(0.06, grid.cellScreen * 0.14);
        addCandidate(
          candidates,
          pointFromCenterOffset(point, dir, -dash),
          pointFromCenterOffset(point, dir, dash),
          emitCap
        );
      }
    }
  }

  const balanced = uniformlyDownsample(candidates, cap);
  return ensureMinimumCandidates(makeResult(balanced, cellsTested, { spacing: grid.cellScreen, tone: toneLevel, diag: metrics.diag, calibratedTone: faceMeta.calibratedTone }), face, toneLevel);
}

const BAYER_8 = [
  [0, 48, 12, 60, 3, 51, 15, 63],
  [32, 16, 44, 28, 35, 19, 47, 31],
  [8, 56, 4, 52, 11, 59, 7, 55],
  [40, 24, 36, 20, 43, 27, 39, 23],
  [2, 50, 14, 62, 1, 49, 13, 61],
  [34, 18, 46, 30, 33, 17, 45, 29],
  [10, 58, 6, 54, 9, 57, 5, 53],
  [42, 26, 38, 22, 41, 25, 37, 21]
];

function orderedDitherStyle(face, toneIndex, faceMeta, _rng, controls) {
  const metrics = faceMetrics(face);
  const darkness = faceMeta.darkness;
  const toneLevel = clamp(Math.round(darkness * 5), 0, 5);
  const cap = strokeCapForFace(controls, faceMeta.calibratedTone, metrics, 2.7);
  const emitCap = Math.min(120000, Math.max(cap * 3, cap + 2200));
  const grid = gridForFace(face, controls, sampleStops([0.66, 0.6, 0.54, 0.48, 0.42, 0.36], darkness), 520);

  const candidates = [];
  let cellsTested = 0;
  const target = clamp(darkness * 1.14 + 0.22, 0.2, 0.999);
  const phase = 0;

  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      if (candidates.length >= emitCap) {
        continue;
      }

      const center = pointFromUv(grid.frame, (col + 0.5) * grid.cellU, (row + 0.5) * grid.cellV);
      if (!sampleVisibleMask(face, center)) {
        continue;
      }

      cellsTested += 1;
      const threshold = (BAYER_8[(row + phase) % 8][(col + phase) % 8] + 0.5) / 64;
      if (target < threshold) {
        continue;
      }

      emitDitherMark(candidates, center, grid.frame, grid.cellScreen * 0.26, toneLevel, row, col, emitCap);
    }
  }

  const balanced = uniformlyDownsample(candidates, cap);
  return ensureMinimumCandidates(makeResult(balanced, cellsTested, { spacing: grid.cellScreen, tone: toneLevel, diag: metrics.diag, calibratedTone: faceMeta.calibratedTone }), face, toneLevel);
}

function errorDiffusionStyle(face, toneIndex, faceMeta, _rng, controls) {
  const metrics = faceMetrics(face);
  const darkness = faceMeta.darkness;
  const toneLevel = clamp(Math.round(darkness * 5), 0, 5);
  const cap = strokeCapForFace(controls, faceMeta.calibratedTone, metrics, 2.66);
  const emitCap = Math.min(120000, Math.max(cap * 3, cap + 2200));
  const grid = gridForFace(face, controls, sampleStops([0.64, 0.58, 0.52, 0.46, 0.4, 0.34], darkness), 520);

  const target = clamp(darkness * 1.12 + 0.2, 0.18, 0.999);
  const err = Array.from({ length: grid.rows + 1 }, () => new Array(grid.cols + 3).fill(0));
  const candidates = [];
  let cellsTested = 0;

  for (let row = 0; row < grid.rows; row += 1) {
    const serp = row % 2 === 1;
    for (let ci = 0; ci < grid.cols; ci += 1) {
      if (candidates.length >= emitCap) {
        continue;
      }

      const col = serp ? grid.cols - 1 - ci : ci;
      const center = pointFromUv(grid.frame, (col + 0.5) * grid.cellU, (row + 0.5) * grid.cellV);
      if (!sampleVisibleMask(face, center)) {
        continue;
      }

      cellsTested += 1;
      const xi = col + 1;
      const dir = serp ? -1 : 1;
      const value = clamp(target + err[row][xi], 0, 1);
      const on = value >= 0.5;
      const quantized = on ? 1 : 0;
      const e = value - quantized;

      err[row][xi + dir] += e * (7 / 16);
      err[row + 1][xi - dir] += e * (3 / 16);
      err[row + 1][xi] += e * (5 / 16);
      err[row + 1][xi + dir] += e * (1 / 16);

      if (!on) {
        continue;
      }

      emitDitherMark(candidates, center, grid.frame, grid.cellScreen * 0.25, toneLevel, row, col, emitCap);
    }
  }

  const balanced = uniformlyDownsample(candidates, cap);
  return ensureMinimumCandidates(makeResult(balanced, cellsTested, { spacing: grid.cellScreen, tone: toneLevel, diag: metrics.diag, calibratedTone: faceMeta.calibratedTone }), face, toneLevel);
}

function asciiStyle(face, toneIndex, faceMeta, _rng, controls, profile = "dense") {
  const metrics = faceMetrics(face);
  const darkness = faceMeta.darkness;
  const toneLevel = clamp(Math.round(darkness * 5), 0, 5);
  const styleConfig = profile === "legacy"
    ? { cell: 0.62, glyphScale: 0.24, glyphs: [".", ":", "-", "+", "#", "%"] }
    : profile === "solid"
      ? { cell: 0.34, glyphScale: 0.32, glyphs: [":", "-", "+", "#", "%", "@"] }
      : { cell: 0.42, glyphScale: 0.29, glyphs: [".", ":", "-", "+", "#", "@"] };

  const asciiCellSize = clamp(Number(controls.asciiCellSize ?? styleConfig.cell), 0.14, 2.2);
  const cap = strokeCapForFace(controls, faceMeta.calibratedTone, metrics, 3.2);
  const grid = gridForFace(face, controls, asciiCellSize, 620);
  const emitCap = Math.min(140000, Math.max(cap * 3, cap + 2600));
  const densityScale = densityControl(controls);
  const skipByTone = [6, 4, 3, 2, 1, 1];
  const skip = Math.max(1, Math.round(skipByTone[toneLevel] / Math.sqrt(densityScale)));
  const glyphRamp = styleConfig.glyphs;
  const baseGlyphIndex = clamp(Math.round((toneLevel / 5) * (glyphRamp.length - 1)), 0, glyphRamp.length - 1);

  const candidates = [];
  let cellsTested = 0;

  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      if (candidates.length >= emitCap) {
        continue;
      }

      const center = pointFromUv(grid.frame, (col + 0.5) * grid.cellU, (row + 0.5) * grid.cellV);
      if (!sampleVisibleMask(face, center)) {
        continue;
      }

      cellsTested += 1;
      if (skip > 1 && ((row + col) % skip) !== 0) {
        continue;
      }

      const t = hash2(row, col, 557);
      const drift = t > 0.82 ? 1 : t < 0.16 ? -1 : 0;
      const glyphIndex = clamp(baseGlyphIndex + drift, 0, glyphRamp.length - 1);
      const glyph = glyphRamp[glyphIndex];
      const glyphScale = clamp(grid.cellScreen * styleConfig.glyphScale, 0.09, grid.cellScreen * 0.42);
      emitGlyph(candidates, center, grid.frame, glyph, glyphScale, emitCap);
    }
  }

  const balanced = uniformlyDownsample(candidates, cap);
  return ensureMinimumCandidates(makeResult(balanced, cellsTested, { spacing: grid.cellScreen, tone: toneLevel, diag: metrics.diag, calibratedTone: faceMeta.calibratedTone }), face, toneLevel);
}

function isShadedSide(face) {
  return Boolean(face?.shadeKey && face.shadeKey !== "none");
}

const SHADER_STYLES = [
  {
    id: "off",
    label: "Off",
    supportsFace: () => false,
    generate: () => makeResult([], 0, { spacing: 0, tone: 0 })
  },
  {
    id: "lines",
    label: "Lines",
    supportsFace: isShadedSide,
    calibration: { toneContrast: 1.08, minInk: 0.04 },
    generate: (face, toneIndex, meta, rng, controls) => linesStyle(face, toneIndex, meta, rng, controls)
  },
  {
    id: "crosshatch",
    label: "Crosshatch",
    supportsFace: isShadedSide,
    calibration: { toneContrast: 1.12, minInk: 0.05 },
    generate: (face, toneIndex, meta, rng, controls) => crosshatchStyle(face, toneIndex, meta, rng, controls)
  },
  {
    id: "stipple",
    label: "Stipple",
    supportsFace: isShadedSide,
    calibration: { toneContrast: 1.18, minInk: 0.06 },
    generate: (face, toneIndex, meta, rng, controls) => stippleStyle(face, toneIndex, meta, rng, controls)
  },
  {
    id: "ordered-dither",
    label: "Ordered Dither",
    supportsFace: isShadedSide,
    calibration: { toneContrast: 1.28, minInk: 0.16 },
    generate: (face, toneIndex, meta, rng, controls) => orderedDitherStyle(face, toneIndex, meta, rng, controls)
  },
  {
    id: "error-diffusion",
    label: "Error Diffusion",
    supportsFace: isShadedSide,
    calibration: { toneContrast: 1.3, minInk: 0.16 },
    generate: (face, toneIndex, meta, rng, controls) => errorDiffusionStyle(face, toneIndex, meta, rng, controls)
  },
  {
    id: "ascii",
    label: "ASCII",
    supportsFace: isShadedSide,
    calibration: { toneContrast: 1.28, toneGamma: 1.05, minInk: 0.09 },
    generate: (face, toneIndex, meta, rng, controls) => asciiStyle(face, toneIndex, meta, rng, controls, "dense")
  },
  {
    id: "ascii-legacy",
    label: "ASCII (Legacy)",
    hidden: true,
    supportsFace: isShadedSide,
    calibration: { toneContrast: 1.06, minInk: 0.03 },
    generate: (face, toneIndex, meta, rng, controls) => asciiStyle(face, toneIndex, meta, rng, controls, "legacy")
  },
  {
    id: "ascii-solid",
    label: "ASCII (Solid)",
    hidden: true,
    supportsFace: isShadedSide,
    calibration: { toneContrast: 1.42, toneGamma: 1.1, minInk: 0.12, blackPoint: 0.02, whitePoint: 0.96 },
    generate: (face, toneIndex, meta, rng, controls) => asciiStyle(face, toneIndex, meta, rng, controls, "solid")
  }
];

const SHADER_STYLE_MAP = new Map(SHADER_STYLES.map((style) => [style.id, style]));
const SHADER_STYLE_ALIASES = new Map([
  ["ascii-dense", "ascii"],
  ["ascii-solid", "ascii-solid"],
  ["ascii-legacy", "ascii-legacy"]
]);

export function shaderStyleOptions() {
  return SHADER_STYLES
    .filter((style) => !style.hidden)
    .map((style) => ({ id: style.id, label: style.label }));
}

export function generateFaceShaderStrokes(face, controls) {
  const styleId = SHADER_STYLE_ALIASES.get(controls.shaderPreset) || controls.shaderPreset;
  const style = SHADER_STYLE_MAP.get(styleId) || SHADER_STYLE_MAP.get("off");
  const toneIndex = toneIndexForFace(face);
  const baseTone01 = toneIndex / 5;
  const calibration = resolveToneCalibration(controls, style?.calibration);
  const density = densityControl(controls);
  const darknessBias = clamp((density - 1) * 0.16, -0.46, 0.46);
  const calibratedTone = clamp(calibrateTone01(baseTone01, calibration) - darknessBias, 0, 1);
  const faceMeta = {
    tone01: baseTone01,
    calibratedTone,
    darkness: 1 - calibratedTone,
    calibration
  };

  if (!face || !style || !style.supportsFace(face)) {
    return {
      strokes: [],
      candidates: [],
      stats: { cellsTested: 0, emittedPreClip: 0, emittedPostClip: 0, toneIndex },
      meta: { spacing: 0, tone: toneIndex, calibratedTone, diag: 0 }
    };
  }

  const rng = createRng(styleSeed(controls, face, toneIndex, 113));
  const result = style.generate(face, toneIndex, faceMeta, rng, controls) || makeResult([], 0, { spacing: 0, tone: toneIndex, calibratedTone });

  return {
    strokes: result.strokes || [],
    candidates: result.candidates || result.strokes || [],
    stats: {
      cellsTested: result.stats?.cellsTested || 0,
      emittedPreClip: result.stats?.emittedPreClip || 0,
      emittedPostClip: result.stats?.emittedPostClip || 0,
      toneIndex,
      calibratedTone
    },
    meta: {
      spacing: Number(result.meta?.spacing) || 0,
      tone: Number(result.meta?.tone) || toneIndex,
      calibratedTone: Number(result.meta?.calibratedTone ?? calibratedTone) || calibratedTone,
      diag: Number(result.meta?.diag) || 0,
      styleId: style?.id || styleId || "off",
      linesMetrics: result.meta?.linesMetrics || null
    }
  };
}
