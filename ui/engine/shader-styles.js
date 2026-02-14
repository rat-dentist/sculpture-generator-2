import { boundsFromPolygons, pointInPolygon } from "./geometry.js";
import { createRng } from "./random.js";
import { toneIndexForFace } from "./projection.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
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

function faceMetrics(face) {
  const bounds = boundsFromPolygons([face.points || []]);
  const width = Math.max(1e-6, bounds.width);
  const height = Math.max(1e-6, bounds.height);
  const diag = Math.max(1e-6, Math.hypot(width, height));
  const area = Math.max(1e-6, polygonArea(face.points || []));

  return {
    bounds,
    width,
    height,
    diag,
    area,
    centroid: polygonCentroid(face.points || [])
  };
}

function effectiveTone(face, toneIndex) {
  let tone = toneIndex;

  // Keep side contrast strong so shader-only views still read as 3D form.
  if (face.faceType === "left") {
    tone += 1.05;
  } else if (face.faceType === "right") {
    tone += 0.1;
  }

  if (face.shadeKey === "z_neg" || face.shadeKey === "y_neg") {
    tone += 0.3;
  }
  if (face.shadeKey === "x_pos") {
    tone -= 0.25;
  }

  return clamp(tone, 0.6, 5);
}

function baseSpacingForFace(metrics, controls) {
  const coarse = controls.shaderCoarse ? 1.22 : 1;
  const densityScale = clamp(Number(controls.shaderSpacingScale ?? 1), 0.45, 2.2);
  const base = clamp(metrics.diag * 0.02, 2, 14);
  return base * coarse * densityScale;
}

function faceStrokeCap(controls, tone, metrics, styleWeight = 1) {
  const hardCap = Math.max(10, Math.round(controls.faceStrokeBudget ?? controls.maxStrokes ?? 180));
  const toneGain = lerp(0.56, 1.36, tone / 5);
  const areaGain = clamp(Math.sqrt(metrics.area) / 26, 0.7, 1.35);
  const cap = Math.round(hardCap * styleWeight * toneGain * areaGain);
  return clamp(cap, 8, hardCap);
}

function lineAngle(faceType, baseAngle) {
  if (faceType === "left") {
    return baseAngle + 30;
  }
  return baseAngle - 30;
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

  if (estA < minLines && estB > estA * 1.18) {
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
  const maxGapForCount = span / minLines;
  return Math.max(0.65, Math.min(gap, maxGapForCount));
}

function makeSegment(a, b) {
  return [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
}

function addCandidate(candidates, a, b, maxStrokes) {
  if (candidates.length >= maxStrokes) {
    return;
  }
  candidates.push(makeSegment(a, b));
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
  const halfLen = Math.max(metrics.diag * 0.9, 4);
  const span = Math.max(1e-6, max - min);
  const nominalCount = Math.max(1, Math.round(span / Math.max(1e-5, gap)) + 1);
  const lineCount = Math.max(1, Math.min(maxStrokes, nominalCount));

  for (let i = 0; i < lineCount; i += 1) {
    const t = lineCount === 1 ? 0.5 : i / (lineCount - 1);
    let projection = min + span * t;
    if (lineCount > 3 && jitter > 0 && rng) {
      projection += (rng() - 0.5) * gap * jitter;
    }

    const linePoint = {
      x: metrics.centroid.x + normal.x * (projection - (metrics.centroid.x * normal.x + metrics.centroid.y * normal.y)),
      y: metrics.centroid.y + normal.y * (projection - (metrics.centroid.x * normal.x + metrics.centroid.y * normal.y))
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

function glyphSegments(center, size, toneBand) {
  const x = center.x;
  const y = center.y;
  const half = size * 0.5;
  const quarter = size * 0.25;

  if (toneBand <= 0) {
    return [];
  }
  if (toneBand === 1) {
    return [makeSegment({ x: x - half * 0.45, y }, { x: x + half * 0.45, y })];
  }
  if (toneBand === 2) {
    return [
      makeSegment({ x: x - half * 0.45, y: y - quarter }, { x: x + half * 0.45, y: y - quarter }),
      makeSegment({ x: x - half * 0.45, y: y + quarter }, { x: x + half * 0.45, y: y + quarter })
    ];
  }
  if (toneBand === 3) {
    return [
      makeSegment({ x: x - half, y }, { x: x + half, y }),
      makeSegment({ x, y: y - half }, { x, y: y + half }),
      makeSegment({ x: x - half * 0.8, y: y - quarter }, { x: x + half * 0.8, y: y - quarter })
    ];
  }
  if (toneBand === 4) {
    return [
      makeSegment({ x: x - half, y }, { x: x + half, y }),
      makeSegment({ x, y: y - half }, { x, y: y + half }),
      makeSegment({ x: x - half, y: y - half }, { x: x + half, y: y + half }),
      makeSegment({ x: x - half, y: y + half }, { x: x + half, y: y - half })
    ];
  }
  return [
    makeSegment({ x: x - half, y }, { x: x + half, y }),
    makeSegment({ x, y: y - half }, { x, y: y + half }),
    makeSegment({ x: x - half, y: y - half }, { x: x + half, y: y + half }),
    makeSegment({ x: x - half, y: y + half }, { x: x + half, y: y - half }),
    makeSegment({ x: x - quarter, y: y - half }, { x: x - quarter, y: y + half }),
    makeSegment({ x: x + quarter, y: y - half }, { x: x + quarter, y: y + half })
  ];
}

const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
];

function contourBands(face, metrics, tone, maxStrokes) {
  const rings = clamp(Math.round(lerp(2, 8, tone / 5)), 2, 9);
  const center = metrics.centroid;
  const candidates = [];

  for (let ri = 1; ri <= rings; ri += 1) {
    const t = ri / (rings + 1);
    const shrink = clamp(1 - t * 0.84, 0.1, 0.95);
    const ring = face.points.map((point) => ({
      x: center.x + (point.x - center.x) * shrink,
      y: center.y + (point.y - center.y) * shrink
    }));

    for (let i = 0; i < ring.length; i += 1) {
      if (candidates.length >= maxStrokes) {
        break;
      }
      const j = (i + 1) % ring.length;
      addCandidate(candidates, ring[i], ring[j], maxStrokes);
    }

    if (candidates.length >= maxStrokes) {
      break;
    }
  }

  return candidates;
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

function ensureMinimumCandidates(result, face, tone) {
  if (tone < 2 || (result.strokes?.length || 0) > 0) {
    return result;
  }

  const center = polygonCentroid(face.points || []);
  const size = 0.7 + tone * 0.25;
  result.strokes = result.strokes || [];
  result.strokes.push(makeSegment(
    { x: center.x - size, y: center.y },
    { x: center.x + size, y: center.y }
  ));
  result.strokes.push(makeSegment(
    { x: center.x, y: center.y - size * 0.85 },
    { x: center.x, y: center.y + size * 0.85 }
  ));
  result.candidates = result.strokes;
  result.stats.emittedPreClip = result.strokes.length;
  result.stats.emittedPostClip = result.strokes.length;
  return result;
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
    supportsFace: (face) => face.faceType !== "top",
    generate: (face, toneIndex, _faceMeta, rng, controls) => {
      const metrics = faceMetrics(face);
      const tone = effectiveTone(face, toneIndex);
      const tone01 = tone / 5;
      const baseSpacing = baseSpacingForFace(metrics, controls);
      const cap = faceStrokeCap(controls, tone, metrics, 1.08);

      let spacing = clamp(
        baseSpacing * lerp(1.8, 0.6, tone01) * (face.faceType === "left" ? 0.82 : 1.08),
        0.9,
        metrics.diag * 0.6
      );
      const minLines = clamp(Math.round(lerp(4, 24, tone01)), 4, 26);
      const baseAngle = lineAngle(face.faceType, 24 + (face.id % 5) * 2);
      const angle = chooseHatchAngle(face, baseAngle, spacing, minLines);
      spacing = tightenGapForCoverage(face, angle, spacing, minLines);

      const candidates = hatchCandidates(face, metrics, angle, spacing, cap, 0.08, rng);
      return ensureMinimumCandidates(makeResult(candidates, 0, { spacing, baseSpacing, tone, diag: metrics.diag }), face, tone);
    }
  },
  {
    id: "crosshatch",
    label: "Crosshatch",
    supportsFace: (face) => face.faceType !== "top",
    generate: (face, toneIndex, _faceMeta, rng, controls) => {
      const metrics = faceMetrics(face);
      const tone = effectiveTone(face, toneIndex);
      const tone01 = tone / 5;
      const baseSpacing = baseSpacingForFace(metrics, controls);
      const cap = faceStrokeCap(controls, tone, metrics, 1.2);

      let gapA = clamp(baseSpacing * lerp(1.55, 0.62, tone01), 0.85, metrics.diag * 0.6);
      const baseAngle = lineAngle(face.faceType, 23 + (face.id % 4) * 2);
      const minLinesA = clamp(Math.round(lerp(4, 17, tone01)), 4, 20);
      const angleA = chooseHatchAngle(face, baseAngle, gapA, minLinesA);
      gapA = tightenGapForCoverage(face, angleA, gapA, minLinesA);

      const firstCap = tone >= 2.4 ? Math.max(6, Math.round(cap * 0.58)) : cap;
      const candidates = hatchCandidates(face, metrics, angleA, gapA, firstCap, 0.08, rng);

      if (tone >= 2 && candidates.length < cap) {
        let gapB = clamp(gapA * lerp(1.14, 0.72, tone01), 0.8, metrics.diag * 0.45);
        const minLinesB = clamp(Math.round(lerp(3, 12, tone01)), 3, 14);
        const angleB = chooseHatchAngle(face, angleA + 90, gapB, minLinesB);
        gapB = tightenGapForCoverage(face, angleB, gapB, minLinesB);
        candidates.push(...hatchCandidates(face, metrics, angleB, gapB, cap - candidates.length, 0.06, rng));
      }

      if (tone >= 4 && candidates.length < cap) {
        let gapC = clamp(gapA * 1.28, 0.9, metrics.diag * 0.7);
        const minLinesC = clamp(Math.round(lerp(2, 7, tone01)), 2, 9);
        const angleC = chooseHatchAngle(face, angleA + 45, gapC, minLinesC);
        gapC = tightenGapForCoverage(face, angleC, gapC, minLinesC);
        candidates.push(...hatchCandidates(face, metrics, angleC, gapC, cap - candidates.length, 0.04, rng));
      }

      return ensureMinimumCandidates(makeResult(candidates.slice(0, cap), 0, { spacing: gapA, baseSpacing, tone, diag: metrics.diag }), face, tone);
    }
  },
  {
    id: "contour-bands",
    label: "Contour Bands",
    supportsFace: (face) => face.faceType !== "top",
    generate: (face, toneIndex, _faceMeta, _rng, controls) => {
      const metrics = faceMetrics(face);
      const tone = effectiveTone(face, toneIndex);
      const baseSpacing = baseSpacingForFace(metrics, controls);
      const cap = faceStrokeCap(controls, tone, metrics, 1.05);
      const candidates = contourBands(face, metrics, tone, cap);
      return ensureMinimumCandidates(makeResult(candidates, 0, { spacing: baseSpacing, baseSpacing, tone, diag: metrics.diag }), face, tone);
    }
  },
  {
    id: "ascii",
    label: "ASCII",
    supportsFace: (face) => face.faceType !== "top",
    generate: (face, toneIndex, _faceMeta, rng, controls) => {
      const metrics = faceMetrics(face);
      const tone = effectiveTone(face, toneIndex);
      const tone01 = tone / 5;
      const toneBand = clamp(Math.round(tone), 1, 5);
      const baseSpacing = baseSpacingForFace(metrics, controls);
      const cap = faceStrokeCap(controls, tone, metrics, 0.98);

      const cell = clamp(baseSpacing * lerp(1.22, 0.56, tone01), 1.8, 14);
      const glyphSize = cell * clamp(0.52 + tone01 * 0.34, 0.45, 0.86);
      const density = clamp(lerp(0.22, 0.98, tone01), 0.14, 1);
      const candidates = [];
      let cellsTested = 0;

      for (let y = metrics.bounds.minY + cell * 0.5; y <= metrics.bounds.maxY - cell * 0.25; y += cell) {
        if (candidates.length >= cap) {
          break;
        }
        for (let x = metrics.bounds.minX + cell * 0.5; x <= metrics.bounds.maxX - cell * 0.25; x += cell) {
          if (candidates.length >= cap) {
            break;
          }
          const center = { x, y };
          if (!pointInPolygon(center, face.points || [])) {
            continue;
          }
          cellsTested += 1;
          if (rng() > density) {
            continue;
          }

          const glyph = glyphSegments(center, glyphSize, toneBand);
          for (const segment of glyph) {
            addCandidate(candidates, segment[0], segment[1], cap);
            if (candidates.length >= cap) {
              break;
            }
          }
        }
      }

      return ensureMinimumCandidates(makeResult(candidates, cellsTested, { spacing: cell, baseSpacing, tone, diag: metrics.diag }), face, tone);
    }
  },
  {
    id: "ordered-dither",
    label: "Ordered Dither",
    supportsFace: (face) => face.faceType !== "top",
    generate: (face, toneIndex, _faceMeta, _rng, controls) => {
      const metrics = faceMetrics(face);
      const tone = effectiveTone(face, toneIndex);
      const tone01 = tone / 5;
      const baseSpacing = baseSpacingForFace(metrics, controls);
      const cap = faceStrokeCap(controls, tone, metrics, 0.92);

      const cell = clamp(baseSpacing * lerp(1.12, 0.52, tone01), 1.6, 12);
      const candidates = [];
      let cellsTested = 0;
      let yi = 0;

      for (let y = metrics.bounds.minY + cell * 0.5; y <= metrics.bounds.maxY - cell * 0.25; y += cell, yi += 1) {
        if (candidates.length >= cap) {
          break;
        }
        let xi = 0;
        for (let x = metrics.bounds.minX + cell * 0.5; x <= metrics.bounds.maxX - cell * 0.25; x += cell, xi += 1) {
          if (candidates.length >= cap) {
            break;
          }
          const center = { x, y };
          if (!pointInPolygon(center, face.points || [])) {
            continue;
          }

          cellsTested += 1;
          const threshold = (BAYER_4[yi % 4][xi % 4] + 0.5) / 16;
          if (tone01 < threshold) {
            continue;
          }

          const glyph = tone >= 4
            ? [
              makeSegment({ x: center.x - cell * 0.2, y: center.y }, { x: center.x + cell * 0.2, y: center.y }),
              makeSegment({ x: center.x, y: center.y - cell * 0.2 }, { x: center.x, y: center.y + cell * 0.2 })
            ]
            : [makeSegment({ x: center.x - cell * 0.2, y: center.y }, { x: center.x + cell * 0.2, y: center.y })];

          for (const segment of glyph) {
            addCandidate(candidates, segment[0], segment[1], cap);
            if (candidates.length >= cap) {
              break;
            }
          }
        }
      }

      return ensureMinimumCandidates(makeResult(candidates, cellsTested, { spacing: cell, baseSpacing, tone, diag: metrics.diag }), face, tone);
    }
  },
  {
    id: "error-diffusion",
    label: "Error Diffusion",
    supportsFace: (face) => face.faceType !== "top",
    generate: (face, toneIndex, _faceMeta, _rng, controls) => {
      const metrics = faceMetrics(face);
      const tone = effectiveTone(face, toneIndex);
      const tone01 = tone / 5;
      const target = clamp(0.08 + tone01 * 0.92, 0, 1);
      const baseSpacing = baseSpacingForFace(metrics, controls);
      const cap = faceStrokeCap(controls, tone, metrics, 0.94);

      const cell = clamp(baseSpacing * lerp(1.14, 0.54, tone01), 1.6, 12);
      const cols = Math.max(1, Math.floor(metrics.width / cell));
      const rows = Math.max(1, Math.floor(metrics.height / cell));
      const err = Array.from({ length: rows + 1 }, () => new Array(cols + 3).fill(0));
      const candidates = [];
      let cellsTested = 0;

      for (let y = 0; y < rows; y += 1) {
        if (candidates.length >= cap) {
          break;
        }

        const serp = y % 2 === 1;
        for (let ci = 0; ci < cols; ci += 1) {
          if (candidates.length >= cap) {
            break;
          }

          const x = serp ? cols - 1 - ci : ci;
          const center = {
            x: metrics.bounds.minX + (x + 0.5) * cell,
            y: metrics.bounds.minY + (y + 0.5) * cell
          };
          if (!pointInPolygon(center, face.points || [])) {
            continue;
          }

          cellsTested += 1;
          const xi = x + 1;
          const dir = serp ? -1 : 1;
          const value = clamp(target + err[y][xi], 0, 1);
          const on = value >= 0.5;
          const quantized = on ? 1 : 0;
          const e = value - quantized;

          err[y][xi + dir] += e * (7 / 16);
          err[y + 1][xi - dir] += e * (3 / 16);
          err[y + 1][xi] += e * (5 / 16);
          err[y + 1][xi + dir] += e * (1 / 16);

          if (!on) {
            continue;
          }

          addCandidate(
            candidates,
            { x: center.x - cell * 0.2, y: center.y },
            { x: center.x + cell * 0.2, y: center.y },
            cap
          );
        }
      }

      return ensureMinimumCandidates(makeResult(candidates, cellsTested, { spacing: cell, baseSpacing, tone, diag: metrics.diag }), face, tone);
    }
  },
  {
    id: "stipple",
    label: "Stipple",
    supportsFace: (face) => face.faceType !== "top",
    generate: (face, toneIndex, _faceMeta, rng, controls) => {
      const metrics = faceMetrics(face);
      const tone = effectiveTone(face, toneIndex);
      const tone01 = tone / 5;
      const baseSpacing = baseSpacingForFace(metrics, controls);
      const cap = faceStrokeCap(controls, tone, metrics, 0.86);

      const spacing = clamp(baseSpacing * lerp(1.25, 0.48, tone01), 1.5, 12);
      const density = clamp(lerp(0.18, 0.98, tone01), 0.1, 1);
      const candidates = [];
      let cellsTested = 0;

      for (let y = metrics.bounds.minY + spacing * 0.5; y <= metrics.bounds.maxY; y += spacing) {
        if (candidates.length >= cap) {
          break;
        }

        for (let x = metrics.bounds.minX + spacing * 0.5; x <= metrics.bounds.maxX; x += spacing) {
          if (candidates.length >= cap) {
            break;
          }

          const center = {
            x: x + (rng() - 0.5) * spacing * 0.42,
            y: y + (rng() - 0.5) * spacing * 0.42
          };
          if (!pointInPolygon(center, face.points || [])) {
            continue;
          }

          cellsTested += 1;
          if (rng() > density) {
            continue;
          }

          const size = tone >= 4 ? 0.24 : 0.2;
          addCandidate(
            candidates,
            { x: center.x - spacing * size, y: center.y },
            { x: center.x + spacing * size, y: center.y },
            cap
          );
        }
      }

      return ensureMinimumCandidates(makeResult(candidates, cellsTested, { spacing, baseSpacing, tone, diag: metrics.diag }), face, tone);
    }
  }
];

const SHADER_STYLE_MAP = new Map(SHADER_STYLES.map((style) => [style.id, style]));

export function shaderStyleOptions() {
  return SHADER_STYLES.map((style) => ({ id: style.id, label: style.label }));
}

export function generateFaceShaderStrokes(face, controls) {
  const style = SHADER_STYLE_MAP.get(controls.shaderPreset) || SHADER_STYLE_MAP.get("off");
  const toneIndex = toneIndexForFace(face);
  const faceMeta = { tone01: toneIndex / 5 };

  if (!face || !style || !style.supportsFace(face)) {
    return {
      strokes: [],
      candidates: [],
      stats: { cellsTested: 0, emittedPreClip: 0, emittedPostClip: 0, toneIndex },
      meta: { spacing: 0, baseSpacing: 0, tone: 0 }
    };
  }

  const rng = createRng(styleSeed(controls, face, toneIndex, 113));
  const result = style.generate(face, toneIndex, faceMeta, rng, controls) || makeResult([], 0, { spacing: 0, tone: 0 });

  return {
    strokes: result.strokes || [],
    candidates: result.candidates || result.strokes || [],
    stats: {
      cellsTested: result.stats?.cellsTested || 0,
      emittedPreClip: result.stats?.emittedPreClip || 0,
      emittedPostClip: result.stats?.emittedPostClip || 0,
      toneIndex
    },
    meta: {
      spacing: Number(result.meta?.spacing) || 0,
      baseSpacing: Number(result.meta?.baseSpacing) || 0,
      tone: Number(result.meta?.tone) || toneIndex,
      diag: Number(result.meta?.diag) || 0
    }
  };
}
