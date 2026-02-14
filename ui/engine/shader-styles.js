import {
  boundsFromPolygons,
  clipInfiniteLineToPolygon,
  clipSegmentToPolygon,
  pointInPolygon
} from "./geometry.js";
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

function lineAngle(faceType, baseAngle) {
  if (faceType === "left") {
    return baseAngle + 30;
  }
  return baseAngle - 30;
}

function hatchPass(face, angleDeg, gap, maxStrokes) {
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

  const strokes = [];
  for (let projection = min - gap; projection <= max + gap; projection += gap) {
    if (strokes.length >= maxStrokes) {
      break;
    }
    const linePoint = { x: normal.x * projection, y: normal.y * projection };
    const clipped = clipInfiniteLineToPolygon(linePoint, direction, face.points);
    if (clipped) {
      strokes.push(clipped);
    }
  }
  return strokes;
}

function glyphSegments(center, size, toneIndex) {
  const x = center.x;
  const y = center.y;
  const s = size;
  const tiny = s * 0.16;
  const half = s * 0.5;
  const quarter = s * 0.25;

  if (toneIndex <= 0) {
    return [];
  }
  if (toneIndex === 1) {
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

const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
];

function emitGlyph(strokes, center, size, type = "dash") {
  const tiny = size * 0.22;
  if (type === "plus") {
    strokes.push([{ x: center.x - tiny, y: center.y }, { x: center.x + tiny, y: center.y }]);
    strokes.push([{ x: center.x, y: center.y - tiny }, { x: center.x, y: center.y + tiny }]);
    return;
  }
  if (type === "x") {
    strokes.push([{ x: center.x - tiny, y: center.y - tiny }, { x: center.x + tiny, y: center.y + tiny }]);
    strokes.push([{ x: center.x - tiny, y: center.y + tiny }, { x: center.x + tiny, y: center.y - tiny }]);
    return;
  }
  strokes.push([{ x: center.x - tiny, y: center.y }, { x: center.x + tiny, y: center.y }]);
}

const SHADER_STYLES = [
  {
    id: "off",
    label: "Off",
    supportsFace: () => false,
    generate: () => ({ strokes: [], stats: { cellsTested: 0, emittedPreClip: 0, emittedPostClip: 0 } })
  },
  {
    id: "lines",
    label: "Lines",
    supportsFace: (face) => face.faceType !== "top",
    generate: (face, toneIndex, _faceMeta, _rng, controls) => {
      const tone01 = toneIndex / 5;
      const coarsen = controls.shaderCoarse ? 1.2 : 1;
      const gap = clamp(lerp(10.2, 2.8, tone01) * coarsen, 1.6, 24);
      const angle = lineAngle(face.faceType, 24 + (face.id % 3) * 3);
      const maxStrokes = Math.max(50, Math.round((controls.maxStrokes * 0.55) / Math.max(1, (6 - toneIndex))));
      const strokes = hatchPass(face, angle, gap, maxStrokes);
      return { strokes, stats: { cellsTested: 0, emittedPreClip: strokes.length, emittedPostClip: strokes.length } };
    }
  },
  {
    id: "crosshatch",
    label: "Crosshatch",
    supportsFace: (face) => face.faceType !== "top",
    generate: (face, toneIndex, _faceMeta, _rng, controls) => {
      const tone01 = toneIndex / 5;
      const coarsen = controls.shaderCoarse ? 1.18 : 1;
      const baseGap = clamp(lerp(10.5, 3.2, tone01) * coarsen, 1.8, 24);
      const angle = lineAngle(face.faceType, 24 + (face.id % 3) * 2);
      const maxStrokes = Math.max(64, Math.round(controls.maxStrokes * 0.58));
      const strokes = hatchPass(face, angle, baseGap, maxStrokes);
      if (toneIndex >= 3 && strokes.length < maxStrokes) {
        const secondGap = clamp(baseGap * lerp(1.18, 0.82, tone01), 1.6, 18);
        const second = hatchPass(face, angle + 90, secondGap, maxStrokes - strokes.length);
        strokes.push(...second);
      }
      return { strokes, stats: { cellsTested: 0, emittedPreClip: strokes.length, emittedPostClip: strokes.length } };
    }
  },
  {
    id: "ascii",
    label: "ASCII",
    supportsFace: (face) => face.faceType !== "top",
    generate: (face, toneIndex, _faceMeta, rng, controls) => {
      const bounds = boundsFromPolygons([face.points]);
      const cell = clamp((controls.shaderCoarse ? 8.6 : 7.2) - (toneIndex >= 4 ? 0.8 : 0), 4.5, 20);
      const glyphSize = cell * clamp(0.66 + toneIndex * 0.03, 0.62, 0.82);
      const skipChance = clamp([1, 0.86, 0.68, 0.5, 0.34, 0.2][toneIndex], 0, 1);
      const maxStrokes = Math.max(80, Math.round(controls.maxStrokes * 0.46));
      const strokes = [];
      let cellsTested = 0;
      let emittedPreClip = 0;

      for (let y = bounds.minY + cell * 0.5; y <= bounds.maxY - cell * 0.25; y += cell) {
        for (let x = bounds.minX + cell * 0.5; x <= bounds.maxX - cell * 0.25; x += cell) {
          if (strokes.length >= maxStrokes) {
            break;
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
              strokes.push(piece);
              if (strokes.length >= maxStrokes) {
                break;
              }
            }
            if (strokes.length >= maxStrokes) {
              break;
            }
          }
        }
      }

      if (!strokes.length && toneIndex >= 2 && controls.occlusionDebug) {
        // eslint-disable-next-line no-console
        console.debug("ascii zero strokes", { faceId: face.id, toneIndex, cellsTested, maxStrokes });
      }

      return { strokes, stats: { cellsTested, emittedPreClip, emittedPostClip: strokes.length } };
    }
  },
  {
    id: "ordered-dither",
    label: "Ordered Dither",
    supportsFace: (face) => face.faceType !== "top",
    generate: (face, toneIndex, _faceMeta, _rng, controls) => {
      const bounds = boundsFromPolygons([face.points]);
      const tone01 = toneIndex / 5;
      const cell = controls.shaderCoarse ? 7.6 : 6.2;
      const maxStrokes = Math.max(80, Math.round(controls.maxStrokes * 0.48));
      const strokes = [];
      let cellsTested = 0;
      let emittedPreClip = 0;
      let yi = 0;
      for (let y = bounds.minY + cell * 0.5; y <= bounds.maxY - cell * 0.25; y += cell, yi += 1) {
        let xi = 0;
        for (let x = bounds.minX + cell * 0.5; x <= bounds.maxX - cell * 0.25; x += cell, xi += 1) {
          if (strokes.length >= maxStrokes) {
            break;
          }
          const center = { x, y };
          if (!pointInPolygon(center, face.points)) {
            continue;
          }
          cellsTested += 1;
          const threshold = (BAYER_4[yi % 4][xi % 4] + 0.5) / 16;
          if (tone01 < threshold) {
            continue;
          }
          const mini = [];
          emitGlyph(mini, center, cell, toneIndex >= 4 ? "plus" : "dash");
          for (const seg of mini) {
            emittedPreClip += 1;
            const clipped = clipSegmentToPolygon(seg[0], seg[1], face.points);
            strokes.push(...clipped);
            if (strokes.length >= maxStrokes) {
              break;
            }
          }
        }
      }
      return { strokes, stats: { cellsTested, emittedPreClip, emittedPostClip: strokes.length } };
    }
  },
  {
    id: "error-diffusion",
    label: "Error Diffusion",
    supportsFace: (face) => face.faceType !== "top",
    generate: (face, toneIndex, _faceMeta, _rng, controls) => {
      const bounds = boundsFromPolygons([face.points]);
      const target = toneIndex / 5;
      const cell = controls.shaderCoarse ? 8.2 : 6.6;
      const cols = Math.max(1, Math.floor((bounds.maxX - bounds.minX) / cell));
      const rows = Math.max(1, Math.floor((bounds.maxY - bounds.minY) / cell));
      const err = Array.from({ length: rows + 1 }, () => new Array(cols + 2).fill(0));
      const strokes = [];
      const maxStrokes = Math.max(80, Math.round(controls.maxStrokes * 0.44));
      let cellsTested = 0;
      let emittedPreClip = 0;
      for (let y = 0; y < rows; y += 1) {
        const serp = y % 2 === 1;
        for (let ci = 0; ci < cols; ci += 1) {
          const x = serp ? cols - 1 - ci : ci;
          const center = { x: bounds.minX + (x + 0.5) * cell, y: bounds.minY + (y + 0.5) * cell };
          if (!pointInPolygon(center, face.points)) {
            continue;
          }
          cellsTested += 1;
          const v = clamp(target + err[y][x], 0, 1);
          const on = v >= 0.5;
          const q = on ? 1 : 0;
          const e = v - q;
          const dir = serp ? -1 : 1;
          err[y][x + dir] += e * (7 / 16);
          err[y + 1][x - dir] += e * (3 / 16);
          err[y + 1][x] += e * (5 / 16);
          err[y + 1][x + dir] += e * (1 / 16);
          if (!on || strokes.length >= maxStrokes) {
            continue;
          }
          const seg = [{ x: center.x - cell * 0.16, y: center.y }, { x: center.x + cell * 0.16, y: center.y }];
          emittedPreClip += 1;
          const clipped = clipSegmentToPolygon(seg[0], seg[1], face.points);
          strokes.push(...clipped);
        }
      }
      return { strokes, stats: { cellsTested, emittedPreClip, emittedPostClip: strokes.length } };
    }
  },
  {
    id: "stipple",
    label: "Stipple",
    supportsFace: (face) => face.faceType !== "top",
    generate: (face, toneIndex, _faceMeta, rng, controls) => {
      const bounds = boundsFromPolygons([face.points]);
      const tone01 = toneIndex / 5;
      const spacing = clamp(lerp(9, 3.8, tone01) * (controls.shaderCoarse ? 1.2 : 1), 2.2, 14);
      const maxStrokes = Math.max(80, Math.round(controls.maxStrokes * 0.42));
      const strokes = [];
      let cellsTested = 0;
      let emittedPreClip = 0;
      for (let y = bounds.minY + spacing * 0.5; y <= bounds.maxY; y += spacing) {
        for (let x = bounds.minX + spacing * 0.5; x <= bounds.maxX; x += spacing) {
          if (strokes.length >= maxStrokes) {
            break;
          }
          const center = { x: x + (rng() - 0.5) * spacing * 0.45, y: y + (rng() - 0.5) * spacing * 0.45 };
          if (!pointInPolygon(center, face.points)) {
            continue;
          }
          cellsTested += 1;
          if (rng() > tone01) {
            continue;
          }
          emittedPreClip += 1;
          const seg = [{ x: center.x - 0.18, y: center.y }, { x: center.x + 0.18, y: center.y }];
          const clipped = clipSegmentToPolygon(seg[0], seg[1], face.points);
          strokes.push(...clipped);
        }
      }
      return { strokes, stats: { cellsTested, emittedPreClip, emittedPostClip: strokes.length } };
    }
  },
  {
    id: "crt-scanline",
    label: "CRT Scanlines",
    supportsFace: (face) => face.faceType !== "top",
    generate: (face, toneIndex, _faceMeta, rng, controls) => {
      const tone01 = toneIndex / 5;
      const gap = clamp(lerp(11, 3.1, tone01) * (controls.shaderCoarse ? 1.25 : 1), 2, 16);
      const angle = 0;
      const lines = hatchPass(face, angle, gap, Math.max(60, Math.round(controls.maxStrokes * 0.5)));
      const strokes = [];
      let emittedPreClip = 0;
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const strong = i % 3 === 0;
        const breakChance = strong ? lerp(0.35, 0.06, tone01) : lerp(0.65, 0.18, tone01);
        if (rng() < breakChance) {
          continue;
        }
        emittedPreClip += 1;
        strokes.push(line);
      }
      return { strokes, stats: { cellsTested: lines.length, emittedPreClip, emittedPostClip: strokes.length } };
    }
  },
  {
    id: "crt-mask",
    label: "CRT Mask",
    supportsFace: (face) => face.faceType !== "top",
    generate: (face, toneIndex, _faceMeta, _rng, controls) => {
      const bounds = boundsFromPolygons([face.points]);
      const cell = controls.shaderCoarse ? 7.8 : 6.2;
      const active = Math.max(0, toneIndex - 1);
      const maxStrokes = Math.max(90, Math.round(controls.maxStrokes * 0.46));
      const strokes = [];
      let cellsTested = 0;
      let emittedPreClip = 0;
      for (let y = bounds.minY + cell * 0.5; y <= bounds.maxY; y += cell) {
        for (let x = bounds.minX + cell * 0.5; x <= bounds.maxX; x += cell) {
          if (strokes.length >= maxStrokes) {
            break;
          }
          const centers = [
            { x: x - cell * 0.24, y },
            { x, y },
            { x: x + cell * 0.24, y }
          ];
          for (let i = 0; i < centers.length && i < active; i += 1) {
            const center = centers[i];
            if (!pointInPolygon(center, face.points)) {
              continue;
            }
            cellsTested += 1;
            emittedPreClip += 1;
            const seg = [{ x: center.x, y: center.y - cell * 0.18 }, { x: center.x, y: center.y + cell * 0.18 }];
            const clipped = clipSegmentToPolygon(seg[0], seg[1], face.points);
            strokes.push(...clipped);
          }
        }
      }
      return { strokes, stats: { cellsTested, emittedPreClip, emittedPostClip: strokes.length } };
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
      stats: { cellsTested: 0, emittedPreClip: 0, emittedPostClip: 0, toneIndex }
    };
  }

  const rng = createRng(styleSeed(controls, face, toneIndex, 113));
  const result = style.generate(face, toneIndex, faceMeta, rng, controls) || { strokes: [], stats: {} };

  return {
    strokes: result.strokes || [],
    stats: {
      cellsTested: result.stats?.cellsTested || 0,
      emittedPreClip: result.stats?.emittedPreClip || 0,
      emittedPostClip: result.stats?.emittedPostClip || 0,
      toneIndex
    }
  };
}
