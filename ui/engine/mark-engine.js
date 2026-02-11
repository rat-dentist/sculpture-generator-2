import {
  boundsFromPolygons,
  clipInfiniteLineToPolygon,
  clipSegmentToPolygon,
  distance,
  dot2,
  pointInPolygon,
  polygonCentroid,
  polylineLength
} from "./geometry.js";
import { createRng } from "./random.js";

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
        continue;
      }

      map.set(key, {
        a,
        b,
        count: 1
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

function makeShadowPolygon(faces) {
  if (!faces.length) {
    return null;
  }

  const allPolygons = faces.map((face) => face.points);
  const bounds = boundsFromPolygons(allPolygons);

  return [
    { x: bounds.minX - 14, y: bounds.maxY + 4 },
    { x: bounds.maxX + 30, y: bounds.maxY + 4 },
    { x: bounds.maxX + 170, y: bounds.maxY + 92 },
    { x: bounds.minX + 74, y: bounds.maxY + 92 }
  ];
}

function addStroke(layers, layerName, points, closed, controls, budget) {
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

  layers[layerName].push({ points, closed });
  budget.used += 1;
}

export function buildStrokeScene(faces, controls) {
  const layers = {
    outline: [],
    internal: [],
    midtone: [],
    dense: []
  };

  const budget = {
    used: 0,
    clipped: 0,
    maxStrokes: controls.maxStrokes
  };

  if (controls.groundShadow) {
    const shadow = makeShadowPolygon(faces);
    if (shadow) {
      const shadowLines = generateHatchSegments(shadow, 90, Math.max(3, controls.hatchSpacing * 0.95));
      for (const line of shadowLines) {
        addStroke(layers, "midtone", line, false, controls, budget);
      }
    }
  }

  const edges = collectVisibleEdges(faces);
  for (const edge of edges.values()) {
    const layer = edge.count > 1 ? "internal" : "outline";
    addStroke(layers, layer, [edge.a, edge.b], false, controls, budget);
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
        addStroke(layers, "midtone", line, false, controls, budget);
      }

      if (mode === "crosshatch") {
        const hatchB = generateHatchSegments(face.points, angleA + 90, controls.hatchSpacing * 1.1);
        for (const line of hatchB) {
          addStroke(layers, "dense", line, false, controls, budget);
        }
      }

      continue;
    }

    if (mode === "stipple") {
      const dots = generateStippleDots(face.points, controls.stippleSpacing, controls.seed + face.id * 13);
      for (const dot of dots) {
        addStroke(layers, "dense", dot, true, controls, budget);
      }
      continue;
    }

    if (mode === "contour") {
      const contours = generateContourSegments(face.points, controls.contourStep, controls.seed + face.id * 29);
      for (const segment of contours) {
        addStroke(layers, "dense", segment, false, controls, budget);
      }
    }
  }

  return {
    faces,
    layers,
    stats: {
      faceCount: faces.length,
      totalStrokes: budget.used,
      clippedStrokes: budget.clipped,
      outlineStrokes: layers.outline.length,
      internalStrokes: layers.internal.length,
      midtoneStrokes: layers.midtone.length,
      denseStrokes: layers.dense.length
    }
  };
}