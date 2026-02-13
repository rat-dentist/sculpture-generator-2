import {
  boundsFromPolygons,
  clipInfiniteLineToPolygon,
  clipSegmentToPolygon,
  pointInPolygon
} from "./geometry.js";
import { createRng } from "./random.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function toneIndexFromShadeKey(shadeKey) {
  if (shadeKey === "z_pos") {
    return 0;
  }
  if (shadeKey === "x_pos") {
    return 1;
  }
  if (shadeKey === "y_pos") {
    return 2;
  }
  if (shadeKey === "x_neg") {
    return 3;
  }
  if (shadeKey === "y_neg") {
    return 4;
  }
  return 5;
}

const PRESETS = {
  off: {
    kind: "off"
  },
  "line-light": {
    kind: "line",
    baseAngle: 24,
    gapMin: 6.2,
    gapMax: 10.2,
    maxStrokeShare: 0.3
  },
  "line-medium": {
    kind: "line",
    baseAngle: 24,
    gapMin: 4.3,
    gapMax: 8.2,
    maxStrokeShare: 0.4
  },
  "line-heavy": {
    kind: "line",
    baseAngle: 24,
    gapMin: 2.7,
    gapMax: 6.1,
    maxStrokeShare: 0.5
  },
  "ascii-light": {
    kind: "ascii",
    cellSize: 8.8,
    glyphScale: 0.62,
    skipByTone: [0.96, 0.9, 0.8, 0.68, 0.56, 0.42],
    maxStrokeShare: 0.28
  },
  "ascii-medium": {
    kind: "ascii",
    cellSize: 7.2,
    glyphScale: 0.68,
    skipByTone: [0.92, 0.82, 0.68, 0.52, 0.36, 0.24],
    maxStrokeShare: 0.36
  },
  "ascii-heavy": {
    kind: "ascii",
    cellSize: 6,
    glyphScale: 0.74,
    skipByTone: [0.88, 0.7, 0.52, 0.34, 0.2, 0.1],
    maxStrokeShare: 0.46
  }
};

function resolvePreset(presetKey) {
  return PRESETS[presetKey] || PRESETS.off;
}

function lineAngle(faceType, baseAngle) {
  if (faceType === "left") {
    return baseAngle + 30;
  }
  return baseAngle - 30;
}

function generateLineShader(face, toneIndex, preset, controls) {
  const tone = clamp(toneIndex / 5, 0, 1);
  const gap = clamp(lerp(preset.gapMax, preset.gapMin, tone), 1.4, 24);
  const angleDeg = lineAngle(face.faceType, preset.baseAngle);
  const angle = (angleDeg * Math.PI) / 180;
  const direction = { x: Math.cos(angle), y: Math.sin(angle) };
  const normal = { x: -Math.sin(angle), y: Math.cos(angle) };

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const point of face.points) {
    const projection = point.x * normal.x + point.y * normal.y;
    min = Math.min(min, projection);
    max = Math.max(max, projection);
  }

  const maxStrokes = Math.max(48, Math.round(controls.maxStrokes * preset.maxStrokeShare));
  const strokes = [];
  for (let projection = min - gap; projection <= max + gap; projection += gap) {
    if (strokes.length >= maxStrokes) {
      break;
    }
    const linePoint = {
      x: normal.x * projection,
      y: normal.y * projection
    };
    const clipped = clipInfiniteLineToPolygon(linePoint, direction, face.points);
    if (clipped) {
      strokes.push(clipped);
    }
  }

  return {
    strokes,
    stats: {
      cellsTested: 0,
      emittedPreClip: strokes.length,
      emittedPostClip: strokes.length
    }
  };
}

function glyphSegments(center, size, toneIndex) {
  const x = center.x;
  const y = center.y;
  const s = size;
  const tiny = s * 0.16;
  const half = s * 0.5;
  const quarter = s * 0.25;

  if (toneIndex <= 1) {
    return [[{ x: x - tiny, y }, { x: x + tiny, y }]];
  }

  if (toneIndex === 2) {
    return [
      [{ x: x - tiny, y: y - quarter }, { x: x + tiny, y: y - quarter }],
      [{ x: x - tiny, y: y + quarter }, { x: x + tiny, y: y + quarter }]
    ];
  }

  if (toneIndex === 3) {
    return [
      [{ x: x - half, y }, { x: x + half, y }],
      [{ x, y: y - half }, { x, y: y + half }],
      [{ x: x - half, y: y - quarter }, { x: x + half, y: y - quarter }],
      [{ x: x - half, y: y + quarter }, { x: x + half, y: y + quarter }]
    ];
  }

  if (toneIndex === 4) {
    return [
      [{ x: x - half, y }, { x: x + half, y }],
      [{ x, y: y - half }, { x, y: y + half }],
      [{ x: x - half, y: y - half }, { x: x + half, y: y + half }],
      [{ x: x - half, y: y + half }, { x: x + half, y: y - half }],
      [{ x: x - half, y: y - quarter }, { x: x + half, y: y - quarter }],
      [{ x: x - half, y: y + quarter }, { x: x + half, y: y + quarter }]
    ];
  }

  return [
    [{ x: x - half, y }, { x: x + half, y }],
    [{ x, y: y - half }, { x, y: y + half }],
    [{ x: x - half, y: y - half }, { x: x + half, y: y + half }],
    [{ x: x - half, y: y + half }, { x: x + half, y: y - half }],
    [{ x: x - half, y: y - quarter }, { x: x + half, y: y - quarter }],
    [{ x: x - half, y: y + quarter }, { x: x + half, y: y + quarter }],
    [{ x: x - quarter, y: y - half }, { x: x - quarter, y: y + half }],
    [{ x: x + quarter, y: y - half }, { x: x + quarter, y: y + half }]
  ];
}

function generateAsciiShader(face, toneIndex, preset, controls) {
  const rng = createRng(controls.seed + face.id * 193 + toneIndex * 17);
  const bounds = boundsFromPolygons([face.points]);
  const cell = clamp(preset.cellSize, 3.5, 20);
  const glyphSize = cell * preset.glyphScale;
  const maxStrokes = Math.max(80, Math.round(controls.maxStrokes * preset.maxStrokeShare));
  const skipChance = clamp(preset.skipByTone[toneIndex] ?? 0.4, 0, 0.98);

  let cellsTested = 0;
  let emittedPreClip = 0;
  const strokes = [];

  for (let y = bounds.minY + cell * 0.5; y <= bounds.maxY - cell * 0.25; y += cell) {
    for (let x = bounds.minX + cell * 0.5; x <= bounds.maxX - cell * 0.25; x += cell) {
      if (strokes.length >= maxStrokes) {
        return {
          strokes,
          stats: {
            cellsTested,
            emittedPreClip,
            emittedPostClip: strokes.length
          }
        };
      }
      const center = { x, y };
      if (!pointInPolygon(center, face.points)) {
        continue;
      }
      cellsTested += 1;
      if (rng() < skipChance) {
        continue;
      }

      const glyph = glyphSegments(center, glyphSize, toneIndex);
      for (const segment of glyph) {
        emittedPreClip += 1;
        const clipped = clipSegmentToPolygon(segment[0], segment[1], face.points);
        for (const piece of clipped) {
          if (strokes.length >= maxStrokes) {
            break;
          }
          strokes.push(piece);
        }
        if (strokes.length >= maxStrokes) {
          break;
        }
      }
    }
  }

  return {
    strokes,
    stats: {
      cellsTested,
      emittedPreClip,
      emittedPostClip: strokes.length
    }
  };
}

export function generateFaceShaderStrokes(face, controls) {
  const preset = resolvePreset(controls.shaderPreset);
  if (!face || face.faceType === "top" || preset.kind === "off") {
    return {
      strokes: [],
      stats: {
        cellsTested: 0,
        emittedPreClip: 0,
        emittedPostClip: 0,
        toneIndex: 0
      }
    };
  }

  const toneIndex = Number.isFinite(face.toneIndex)
    ? clamp(Math.round(face.toneIndex), 0, 5)
    : toneIndexFromShadeKey(face.shadeKey);

  if (preset.kind === "line") {
    const result = generateLineShader(face, toneIndex, preset, controls);
    return {
      strokes: result.strokes,
      stats: {
        ...result.stats,
        toneIndex
      }
    };
  }

  const ascii = generateAsciiShader(face, toneIndex, preset, controls);
  return {
    strokes: ascii.strokes,
    stats: {
      ...ascii.stats,
      toneIndex
    }
  };
}
