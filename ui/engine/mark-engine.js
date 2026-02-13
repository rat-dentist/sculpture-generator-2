import {
  boundsFromPolygons,
  distance,
  polylineLength
} from "./geometry.js";
import { generateFaceShaderStrokes } from "./shader-styles.js";

function nearlyEqual(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

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

function dot3(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function normalsParallel(a, b, eps = 1e-4) {
  const na = normalize3(a);
  const nb = normalize3(b);
  return dot3(na, nb) >= 1 - eps;
}

function q(value, eps = 1e-4) {
  return Math.round(value / eps);
}

function key3(point) {
  return `${q(point.x)},${q(point.y)},${q(point.z)}`;
}

function edgeKey3(a, b) {
  const p0 = key3(a);
  const p1 = key3(b);
  return p0 < p1 ? `${p0}|${p1}` : `${p1}|${p0}`;
}

function collectVisibleEdges(faces) {
  const map = new Map();

  for (const face of faces) {
    const corners3 = face.worldCorners || [];
    const points2 = face.points || [];
    const points3 = face.points3 || [];

    for (let i = 0; i < points2.length; i += 1) {
      const j = (i + 1) % points2.length;

      const a2 = points2[i];
      const b2 = points2[j];
      const a3 = corners3[i] || { x: a2.x, y: a2.y, z: 0 };
      const b3 = corners3[j] || { x: b2.x, y: b2.y, z: 0 };
      const aDepth = Number.isFinite(points3[i]?.depth) ? points3[i].depth : face.depth;
      const bDepth = Number.isFinite(points3[j]?.depth) ? points3[j].depth : face.depth;

      const key = edgeKey3(a3, b3);
      const current = map.get(key);
      const instance = {
        a: a2,
        b: b2,
        aDepth,
        bDepth,
        faceId: face.id,
        normal: face.normal
      };

      if (current) {
        current.instances.push(instance);
      } else {
        map.set(key, { instances: [instance] });
      }
    }
  }

  const edges = [];

  for (const entry of map.values()) {
    const instances = entry.instances;
    const first = instances[0];
    const faceIds = [...new Set(instances.map((item) => item.faceId))];
    const allParallel = instances.length > 1
      ? instances.every((item) => normalsParallel(item.normal, first.normal))
      : false;
    const equalVisibility = instances.length > 1
      ? instances.every((item) => nearlyEqual(item.aDepth, first.aDepth, 1e-3) && nearlyEqual(item.bDepth, first.bDepth, 1e-3))
      : false;

    edges.push({
      a: first.a,
      b: first.b,
      aDepth: first.aDepth,
      bDepth: first.bDepth,
      depth: Math.max(first.aDepth, first.bDepth),
      faceIds,
      classification: allParallel && equalVisibility ? "internal" : "silhouette"
    });
  }

  return edges;
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


function addStroke(layers, layerName, points, closed, controls, budget, options = {}) {
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

  const depthA = Number.isFinite(options.depthA) ? options.depthA : Number.NEGATIVE_INFINITY;
  const depthB = Number.isFinite(options.depthB) ? options.depthB : depthA;

  layers[layerName].push({
    points,
    closed,
    depth: Math.max(depthA, depthB),
    depthA,
    depthB,
    faceIds: Array.isArray(options.faceIds) ? options.faceIds : []
  });
  budget.used += 1;
}

function edge2(a, b, c) {
  return (c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x);
}

function buildOcclusionBuffer(faces, options = {}) {
  if (!faces.length) {
    return null;
  }

  const polygons = faces.map((face) => face.points || []);
  const bounds = boundsFromPolygons(polygons);
  const maxDim = Math.max(320, Number(options.maxDim) || 2400);
  const maxScale = clamp(Number(options.maxScale ?? 4), 0.4, 4);
  const minScale = clamp(Number(options.minScale ?? 0.5), 0.2, maxScale);
  const scale = clamp(
    Math.min(maxDim / Math.max(1, bounds.width), maxDim / Math.max(1, bounds.height), maxScale),
    minScale,
    maxScale
  );

  const paddingPx = 3;
  const originX = bounds.minX - paddingPx / scale;
  const originY = bounds.minY - paddingPx / scale;
  const width = Math.max(16, Math.ceil(bounds.width * scale) + paddingPx * 2 + 2);
  const height = Math.max(16, Math.ceil(bounds.height * scale) + paddingPx * 2 + 2);
  const size = width * height;

  const depthBuffer = new Float32Array(size);
  const faceBuffer = new Int32Array(size);
  depthBuffer.fill(Number.NEGATIVE_INFINITY);
  faceBuffer.fill(-1);

  const toRaster = (point) => ({
    x: (point.x - originX) * scale,
    y: (point.y - originY) * scale,
    depth: point.depth
  });

  const rasterizeTriangle = (v0, v1, v2, faceId) => {
    const minX = Math.max(0, Math.floor(Math.min(v0.x, v1.x, v2.x)));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(v0.x, v1.x, v2.x)));
    const minY = Math.max(0, Math.floor(Math.min(v0.y, v1.y, v2.y)));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(v0.y, v1.y, v2.y)));

    const area = edge2(v0, v1, v2);
    if (Math.abs(area) < 1e-8) {
      return;
    }

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const p = { x: x + 0.5, y: y + 0.5 };
        const w0 = edge2(v1, v2, p) / area;
        const w1 = edge2(v2, v0, p) / area;
        const w2 = edge2(v0, v1, p) / area;

        if (w0 < -1e-5 || w1 < -1e-5 || w2 < -1e-5) {
          continue;
        }

        const depth = w0 * v0.depth + w1 * v1.depth + w2 * v2.depth;
        const index = y * width + x;
        if (depth > depthBuffer[index]) {
          depthBuffer[index] = depth;
          faceBuffer[index] = faceId;
        }
      }
    }
  };

  for (const face of faces) {
    const pts = face.points3 || [];
    if (pts.length < 3) {
      continue;
    }

    const origin = toRaster(pts[0]);
    for (let i = 1; i < pts.length - 1; i += 1) {
      const v1 = toRaster(pts[i]);
      const v2 = toRaster(pts[i + 1]);
      rasterizeTriangle(origin, v1, v2, face.id);
    }
  }

  let depthPreview = [];
  if (options.includeDepthPreview) {
    let minDepth = Number.POSITIVE_INFINITY;
    let maxDepth = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < depthBuffer.length; i += 1) {
      const value = depthBuffer[i];
      if (!Number.isFinite(value) || value === Number.NEGATIVE_INFINITY) {
        continue;
      }
      minDepth = Math.min(minDepth, value);
      maxDepth = Math.max(maxDepth, value);
    }

    if (!Number.isFinite(minDepth) || !Number.isFinite(maxDepth) || maxDepth <= minDepth + 1e-6) {
      return {
        width,
        height,
        originX,
        originY,
        scale,
        depthBuffer,
        faceBuffer,
        depthPreview
      };
    }

    const previewW = Math.min(64, width);
    const previewH = Math.min(64, height);
    const sx = width / previewW;
    const sy = height / previewH;
    const cells = [];

    for (let py = 0; py < previewH; py += 1) {
      for (let px = 0; px < previewW; px += 1) {
        let sum = 0;
        let count = 0;

        const x0 = Math.floor(px * sx);
        const x1 = Math.min(width, Math.ceil((px + 1) * sx));
        const y0 = Math.floor(py * sy);
        const y1 = Math.min(height, Math.ceil((py + 1) * sy));

        for (let y = y0; y < y1; y += 1) {
          for (let x = x0; x < x1; x += 1) {
            const value = depthBuffer[y * width + x];
            if (!Number.isFinite(value) || value === Number.NEGATIVE_INFINITY) {
              continue;
            }
            sum += value;
            count += 1;
          }
        }

        if (!count) {
          continue;
        }

        const avg = sum / count;
        const t = clamp((avg - minDepth) / (maxDepth - minDepth), 0, 1);
        cells.push({ x: px, y: py, t });
      }
    }

    depthPreview = [{ w: previewW, h: previewH, cells }];
  }

  return {
    width,
    height,
    originX,
    originY,
    scale,
    depthBuffer,
    faceBuffer,
    depthPreview
  };
}

function sampleOcclusion(ctx, point) {
  const x = Math.round((point.x - ctx.originX) * ctx.scale);
  const y = Math.round((point.y - ctx.originY) * ctx.scale);

  if (x < 0 || y < 0 || x >= ctx.width || y >= ctx.height) {
    return { depth: Number.NEGATIVE_INFINITY, faceId: -1 };
  }

  const index = y * ctx.width + x;
  return {
    depth: ctx.depthBuffer[index],
    faceId: ctx.faceBuffer[index]
  };
}

function isOccludedAt(ctx, point, depth, faceIds = [], bias = 0.03) {
  const sample = sampleOcclusion(ctx, point);
  if (!Number.isFinite(sample.depth) || sample.depth === Number.NEGATIVE_INFINITY) {
    return false;
  }
  if (sample.faceId >= 0 && faceIds.includes(sample.faceId)) {
    return false;
  }
  return sample.depth > depth + bias;
}

function lerpPoint(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t
  };
}

function smoothVisibilityRuns(raw, minVisibleRun = 2, maxHiddenGap = 3) {
  if (!raw.length) {
    return raw;
  }

  const flags = [...raw];
  const runs = [];
  let start = 0;
  let current = flags[0];

  for (let i = 1; i <= flags.length; i += 1) {
    if (i === flags.length || flags[i] !== current) {
      runs.push({ value: current, start, end: i - 1, len: i - start });
      if (i < flags.length) {
        start = i;
        current = flags[i];
      }
    }
  }

  if (minVisibleRun > 1) {
    for (const run of runs) {
      if (run.value && run.len < minVisibleRun) {
        for (let i = run.start; i <= run.end; i += 1) {
          flags[i] = false;
        }
      }
    }
  }

  for (let i = 1; i < runs.length - 1; i += 1) {
    const run = runs[i];
    if (run.value || run.len > maxHiddenGap) {
      continue;
    }
    if (runs[i - 1].value && runs[i + 1].value) {
      for (let j = run.start; j <= run.end; j += 1) {
        flags[j] = true;
      }
    }
  }

  return flags;
}

function segmentDirection(segment) {
  const a = segment.points[0];
  const b = segment.points[1];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1e-9) {
    return { x: 0, y: 0, len: 0 };
  }
  return { x: (b.x - a.x) / len, y: (b.y - a.y) / len, len };
}

function pointLineDistance(point, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const den = Math.hypot(vx, vy) || 1;
  return Math.abs((point.x - a.x) * vy - (point.y - a.y) * vx) / den;
}

function segmentIntersection(a0, a1, b0, b1) {
  const r = { x: a1.x - a0.x, y: a1.y - a0.y };
  const s = { x: b1.x - b0.x, y: b1.y - b0.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-9) {
    return null;
  }

  const qp = { x: b0.x - a0.x, y: b0.y - a0.y };
  const t = (qp.x * s.y - qp.y * s.x) / denom;
  const u = (qp.x * r.y - qp.y * r.x) / denom;
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) {
    return null;
  }

  return {
    t,
    u,
    point: {
      x: a0.x + r.x * t,
      y: a0.y + r.y * t
    }
  };
}

function clipStrokeByDepthBuffer(stroke, ctx, debugSamples = null, options = {}) {
  if (!ctx) {
    return [stroke];
  }

  if (stroke.closed) {
    const center = stroke.points.reduce(
      (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
      { x: 0, y: 0 }
    );
    center.x /= stroke.points.length;
    center.y /= stroke.points.length;

    const depth = Number.isFinite(stroke.depth) ? stroke.depth : Number.NEGATIVE_INFINITY;
    const occluded = isOccludedAt(ctx, center, depth, stroke.faceIds || [], 0.0025);
    if (debugSamples && debugSamples.length < 1200) {
      debugSamples.push({ point: center, visible: !occluded });
    }

    if (occluded) {
      return [];
    }

    return [stroke];
  }

  if (stroke.points.length < 2 || !Number.isFinite(stroke.depth)) {
    return [stroke];
  }

  const faceIds = stroke.faceIds || [];
  const start = stroke.points[0];
  const end = stroke.points[1];
  const length = distance(start, end);
  const sampleSpacingPx = Math.max(0.6, Number(options.sampleSpacingPx ?? 1.2));
  const minSamples = Math.max(3, Math.round(Number(options.minSamples ?? 12)));
  const steps = Math.max(minSamples, Math.ceil((length * ctx.scale) / sampleSpacingPx));
  const kept = [];
  const sampleEvery = Math.max(1, Math.floor((steps + 1) / 24));
  const depthEps = Math.max(0.0015, 0.007 / Math.max(0.5, ctx.scale));
  const samples = [];
  const minVisibleRun = Math.max(1, Math.round(options.minVisibleRun ?? 2));
  const maxHiddenGap = Math.max(0, Math.round(options.maxHiddenGap ?? 3));
  const trimRatio = clamp(Number(options.trimRatio ?? 0.03), 0, 0.2);
  const trimPixelCap = Math.max(0, Number(options.trimPixelCap ?? 0.05));
  const minPixelLength = Math.max(0.4, Number(options.minPixelLength ?? 0.7));

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const point = lerpPoint(start, end, t);
    const depth = stroke.depthA + (stroke.depthB - stroke.depthA) * t;
    const visible = !isOccludedAt(ctx, point, depth, faceIds, depthEps);
    samples.push({ t, point, depth, visibleRaw: visible });
  }

  const stableVisible = smoothVisibilityRuns(
    samples.map((sample) => sample.visibleRaw),
    minVisibleRun,
    maxHiddenGap
  );

  if (debugSamples) {
    for (let i = 0; i < samples.length; i += sampleEvery) {
      if (debugSamples.length >= 1200) {
        break;
      }
      debugSamples.push({ point: samples[i].point, visible: stableVisible[i] });
    }
  }

  const last = samples.length - 1;
  let index = 0;
  while (index <= last) {
    if (!stableVisible[index]) {
      index += 1;
      continue;
    }

    const runStart = index;
    while (index < last && stableVisible[index + 1]) {
      index += 1;
    }
    const runEnd = index;

    let t0 = runStart === 0
      ? 0
      : (samples[runStart - 1].t + samples[runStart].t) * 0.5;
    let t1 = runEnd === last
      ? 1
      : (samples[runEnd].t + samples[runEnd + 1].t) * 0.5;
    const trimT = Math.min((t1 - t0) * trimRatio, trimPixelCap / Math.max(1, length * ctx.scale));
    t0 += trimT;
    t1 -= trimT;

    if (t1 > t0 + 1e-5) {
      const a = lerpPoint(start, end, t0);
      const b = lerpPoint(start, end, t1);
      const da = stroke.depthA + (stroke.depthB - stroke.depthA) * t0;
      const db = stroke.depthA + (stroke.depthB - stroke.depthA) * t1;
      if (distance(a, b) * ctx.scale >= minPixelLength) {
        kept.push({
          points: [a, b],
          closed: false,
          depth: Math.max(da, db),
          depthA: da,
          depthB: db,
          faceIds
        });
      }
    }

    index += 1;
  }

  return kept;
}

function snapEndpoints(strokes, tolerance) {
  if (!strokes.length || tolerance <= 0) {
    return { strokes, clusters: [] };
  }

  const inv = 1 / tolerance;
  const buckets = new Map();
  const clusters = [];

  const bucketKey = (x, y) => `${Math.round(x * inv)},${Math.round(y * inv)}`;

  const assign = (point) => {
    const bx = Math.round(point.x * inv);
    const by = Math.round(point.y * inv);
    let best = -1;
    let bestDist = Number.POSITIVE_INFINITY;

    for (let oy = -1; oy <= 1; oy += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        const ids = buckets.get(`${bx + ox},${by + oy}`);
        if (!ids) {
          continue;
        }
        for (const clusterId of ids) {
          const cluster = clusters[clusterId];
          const d = Math.hypot(cluster.x - point.x, cluster.y - point.y);
          if (d <= tolerance && d < bestDist) {
            best = clusterId;
            bestDist = d;
          }
        }
      }
    }

    if (best >= 0) {
      const cluster = clusters[best];
      cluster.count += 1;
      cluster.x += (point.x - cluster.x) / cluster.count;
      cluster.y += (point.y - cluster.y) / cluster.count;
      return best;
    }

    const clusterId = clusters.length;
    clusters.push({ x: point.x, y: point.y, count: 1 });
    const key = bucketKey(point.x, point.y);
    if (!buckets.has(key)) {
      buckets.set(key, []);
    }
    buckets.get(key).push(clusterId);
    return clusterId;
  };

  const endpointToCluster = [];
  for (let i = 0; i < strokes.length; i += 1) {
    const stroke = strokes[i];
    endpointToCluster[i] = [
      assign(stroke.points[0]),
      assign(stroke.points[1])
    ];
  }

  const snapped = strokes.map((stroke, index) => {
    const a = clusters[endpointToCluster[index][0]];
    const b = clusters[endpointToCluster[index][1]];
    return {
      ...stroke,
      points: [
        { x: a.x, y: a.y },
        { x: b.x, y: b.y }
      ]
    };
  });

  return {
    strokes: snapped,
    clusters
  };
}

function mergeCollinearStrokes(strokes, options) {
  const angleTolerance = (options?.angleToleranceDeg ?? 0.9) * (Math.PI / 180);
  const cosTolerance = Math.cos(angleTolerance);
  const joinTolerance = options?.joinTolerance ?? 0.35;
  const lineTolerance = options?.lineTolerance ?? joinTolerance * 0.75;
  const maxIterations = options?.maxIterations ?? 2400;

  const canMerge = (a, b) => {
    const da = segmentDirection(a);
    const db = segmentDirection(b);
    if (da.len < 1e-9 || db.len < 1e-9) {
      return false;
    }

    const cos = Math.abs(da.x * db.x + da.y * db.y);
    if (cos < cosTolerance) {
      return false;
    }

    const a0 = a.points[0];
    const a1 = a.points[1];
    const b0 = b.points[0];
    const b1 = b.points[1];
    if (pointLineDistance(b0, a0, a1) > lineTolerance || pointLineDistance(b1, a0, a1) > lineTolerance) {
      return false;
    }

    const proj = (point) => (point.x - a0.x) * da.x + (point.y - a0.y) * da.y;
    const ta0 = proj(a0);
    const ta1 = proj(a1);
    const tb0 = proj(b0);
    const tb1 = proj(b1);
    const minA = Math.min(ta0, ta1);
    const maxA = Math.max(ta0, ta1);
    const minB = Math.min(tb0, tb1);
    const maxB = Math.max(tb0, tb1);
    const overlap = Math.min(maxA, maxB) - Math.max(minA, minB);
    const gap = overlap >= 0 ? 0 : -overlap;

    return gap <= joinTolerance;
  };

  const merge = (a, b) => {
    const d = segmentDirection(a);
    const origin = a.points[0];
    const proj = (point) => (point.x - origin.x) * d.x + (point.y - origin.y) * d.y;
    const values = [
      proj(a.points[0]),
      proj(a.points[1]),
      proj(b.points[0]),
      proj(b.points[1])
    ];
    const minT = Math.min(...values);
    const maxT = Math.max(...values);
    const p0 = { x: origin.x + d.x * minT, y: origin.y + d.y * minT };
    const p1 = { x: origin.x + d.x * maxT, y: origin.y + d.y * maxT };

    return {
      ...a,
      points: [p0, p1],
      depthA: Math.max(
        Number.isFinite(a.depthA) ? a.depthA : Number.NEGATIVE_INFINITY,
        Number.isFinite(b.depthA) ? b.depthA : Number.NEGATIVE_INFINITY
      ),
      depthB: Math.max(
        Number.isFinite(a.depthB) ? a.depthB : Number.NEGATIVE_INFINITY,
        Number.isFinite(b.depthB) ? b.depthB : Number.NEGATIVE_INFINITY
      ),
      faceIds: [...new Set([...(a.faceIds || []), ...(b.faceIds || [])])]
    };
  };

  const merged = [...strokes];
  let changed = true;
  let iterations = 0;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations += 1;

    for (let i = 0; i < merged.length; i += 1) {
      for (let j = i + 1; j < merged.length; j += 1) {
        if (!canMerge(merged[i], merged[j])) {
          continue;
        }
        const next = merge(merged[i], merged[j]);
        merged.splice(j, 1);
        merged.splice(i, 1, next);
        changed = true;
        break;
      }
      if (changed) {
        break;
      }
    }
  }

  return merged;
}

function trimOvershootAtCorners(strokes, trimTolerance) {
  if (!strokes.length || trimTolerance <= 0) {
    return strokes;
  }

  const trimmed = strokes.map((stroke) => ({
    ...stroke,
    points: [
      { ...stroke.points[0] },
      { ...stroke.points[1] }
    ]
  }));

  for (let i = 0; i < trimmed.length; i += 1) {
    const stroke = trimmed[i];
    for (let end = 0; end < 2; end += 1) {
      const endpoint = stroke.points[end];
      const opposite = stroke.points[1 - end];
      let best = null;
      let bestDist = Number.POSITIVE_INFINITY;

      for (let j = 0; j < trimmed.length; j += 1) {
        if (i === j) {
          continue;
        }

        const other = trimmed[j];
        const hit = segmentIntersection(stroke.points[0], stroke.points[1], other.points[0], other.points[1]);
        if (!hit) {
          continue;
        }

        const distToEndpoint = distance(endpoint, hit.point);
        if (distToEndpoint <= 1e-6 || distToEndpoint > trimTolerance) {
          continue;
        }
        if (distance(opposite, hit.point) <= distToEndpoint + 1e-6) {
          continue;
        }
        if (best === null || distToEndpoint < bestDist) {
          best = hit.point;
          bestDist = distToEndpoint;
        }
      }

      if (best) {
        stroke.points[end] = best;
      }
    }
  }

  return trimmed.filter((stroke) => distance(stroke.points[0], stroke.points[1]) > 1e-6);
}

function removeMicroSegments(strokes, minimumLength) {
  if (!strokes.length || minimumLength <= 0) {
    return { strokes, removed: 0 };
  }

  const kept = [];
  let removed = 0;

  for (const stroke of strokes) {
    if (distance(stroke.points[0], stroke.points[1]) < minimumLength) {
      removed += 1;
      continue;
    }
    kept.push(stroke);
  }

  if (!kept.length && strokes.length) {
    let best = strokes[0];
    let bestLen = distance(best.points[0], best.points[1]);
    for (let i = 1; i < strokes.length; i += 1) {
      const len = distance(strokes[i].points[0], strokes[i].points[1]);
      if (len > bestLen) {
        best = strokes[i];
        bestLen = len;
      }
    }
    return { strokes: [best], removed: Math.max(0, removed - 1) };
  }

  return { strokes: kept, removed };
}

function cleanupEdgeStrokes(strokes, depthBuffer, options = {}) {
  const open = [];
  const passthrough = [];

  for (const stroke of strokes) {
    if (!stroke.closed && stroke.points.length >= 2) {
      open.push({
        ...stroke,
        points: [
          { ...stroke.points[0] },
          { ...stroke.points[1] }
        ]
      });
    } else {
      passthrough.push(stroke);
    }
  }

  if (!open.length) {
    return {
      strokes,
      debug: {
        preMerge: [],
        postMerge: [],
        endpointClusters: [],
        segmentsBefore: 0,
        segmentsAfter: 0,
        removedMicroSegments: 0
      }
    };
  }

  const scale = Math.max(0.5, depthBuffer?.scale || 1);
  const pxToWorld = 1 / scale;
  const clusterTolerance = (options.clusterTolerancePx ?? 1.2) * pxToWorld;
  const joinTolerance = (options.joinTolerancePx ?? 1.35) * pxToWorld;
  const trimTolerance = (options.trimTolerancePx ?? 1.15) * pxToWorld;
  const lineTolerance = (options.lineTolerancePx ?? 0.8) * pxToWorld;
  const minLength = Math.max(
    Number(options.minSegment || 0.8) * 0.7,
    0.45 * pxToWorld
  );

  const preMerge = open.map((stroke) => ({
    points: [
      { ...stroke.points[0] },
      { ...stroke.points[1] }
    ],
    closed: false
  }));

  let cleaned = open;
  const snappedA = snapEndpoints(cleaned, clusterTolerance);
  cleaned = snappedA.strokes;
  cleaned = trimOvershootAtCorners(cleaned, trimTolerance);
  cleaned = mergeCollinearStrokes(cleaned, {
    angleToleranceDeg: 0.9,
    joinTolerance,
    lineTolerance
  });
  const snappedB = snapEndpoints(cleaned, clusterTolerance * 0.8);
  cleaned = snappedB.strokes;
  cleaned = mergeCollinearStrokes(cleaned, {
    angleToleranceDeg: 0.9,
    joinTolerance: joinTolerance * 0.85,
    lineTolerance
  });
  cleaned = trimOvershootAtCorners(cleaned, trimTolerance * 0.9);
  const micro = removeMicroSegments(cleaned, minLength);
  cleaned = micro.strokes;

  const postMerge = cleaned.map((stroke) => ({
    points: [
      { ...stroke.points[0] },
      { ...stroke.points[1] }
    ],
    closed: false
  }));

  return {
    strokes: [...cleaned, ...passthrough],
    debug: {
      preMerge,
      postMerge,
      endpointClusters: snappedB.clusters || [],
      segmentsBefore: preMerge.length,
      segmentsAfter: postMerge.length,
      removedMicroSegments: micro.removed
    }
  };
}

function occludeLayer(strokes, depthBuffer, debugSamples = null, options = {}) {
  const clipped = [];
  for (const stroke of strokes) {
    const kept = clipStrokeByDepthBuffer(stroke, depthBuffer, debugSamples, options.clip);
    for (const item of kept) {
      clipped.push(item);
    }
  }

  if (options.cleanup) {
    return cleanupEdgeStrokes(clipped, depthBuffer, {
      minSegment: options.minSegment
    });
  }

  return {
    strokes: clipped,
    debug: null
  };
}

function stripDepth(layer) {
  return layer.map(({ points, closed }) => ({ points, closed }));
}

function faceBoundsStroke(face) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of face.points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return {
    points: [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
      { x: minX, y: minY }
    ],
    closed: false
  };
}

function faceLabel(face) {
  const sum = face.points.reduce(
    (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
    { x: 0, y: 0 }
  );
  const cx = sum.x / face.points.length;
  const cy = sum.y / face.points.length;
  return {
    x: cx,
    y: cy,
    text: `${face.drawOrder}:${face.id} d(${face.minDepth.toFixed(1)},${face.depth.toFixed(1)},${face.maxDepth.toFixed(1)})`
  };
}

function sampleMarker(point, radius = 0.16) {
  return {
    points: makeDot(point, radius, 6),
    closed: true
  };
}

export function buildStrokeScene(faces, controls, options = {}) {
  const fastMode = Boolean(options.fastMode);
  const layers = {
    outline: [],
    internal: [],
    shader: []
  };

  const budget = {
    used: 0,
    clipped: 0,
    maxStrokes: fastMode ? Math.min(controls.maxStrokes, 4200) : controls.maxStrokes
  };
  const showDebug = Boolean(controls.occlusionDebug) && !fastMode;
  const shaderDebug = {
    facesShaded: 0,
    cellsTested: 0,
    emittedPreClip: 0,
    emittedPostClip: 0
  };

  const edges = collectVisibleEdges(faces);
  for (const edge of edges) {
    const layer = edge.classification === "internal" ? "internal" : "outline";
    addStroke(layers, layer, [edge.a, edge.b], false, controls, budget, {
      depthA: edge.aDepth,
      depthB: edge.bDepth,
      faceIds: edge.faceIds
    });
  }

  if (!fastMode) {
    for (const face of faces) {
      if (face.faceType === "top") {
        continue;
      }
      if (controls.shaderPreset === "off") {
        continue;
      }
      const shader = generateFaceShaderStrokes(face, controls);
      const strokes = shader.strokes || [];
      if (strokes.length) {
        shaderDebug.facesShaded += 1;
      }
      shaderDebug.cellsTested += shader.stats?.cellsTested || 0;
      shaderDebug.emittedPreClip += shader.stats?.emittedPreClip || 0;
      shaderDebug.emittedPostClip += shader.stats?.emittedPostClip || 0;
      for (const stroke of strokes) {
        addStroke(layers, "shader", stroke, false, controls, budget, {
          depthA: face.depth,
          depthB: face.depth,
          faceIds: [face.id]
        });
      }
    }
  }

  const depthBuffer = buildOcclusionBuffer(faces, {
    includeDepthPreview: showDebug,
    maxDim: fastMode ? 1200 : 2400,
    maxScale: fastMode ? 2 : 4,
    minScale: fastMode ? 0.35 : 0.5
  });
  const sampleDebug = showDebug ? [] : null;
  const outlineOcclusion = occludeLayer(layers.outline, depthBuffer, sampleDebug, {
    cleanup: !fastMode,
    minSegment: controls.minSegment,
    clip: fastMode
      ? {
        minSamples: 6,
        sampleSpacingPx: 2.4,
        minVisibleRun: 1,
        maxHiddenGap: 2,
        trimRatio: 0.012,
        trimPixelCap: 0.02,
        minPixelLength: 0.85
      }
      : {
        minVisibleRun: 1,
        maxHiddenGap: 3,
        trimRatio: 0.025,
        trimPixelCap: 0.04,
        minPixelLength: 0.55
      }
  });
  const internalOcclusion = occludeLayer(layers.internal, depthBuffer, sampleDebug, {
    cleanup: !fastMode,
    minSegment: controls.minSegment,
    clip: fastMode
      ? {
        minSamples: 6,
        sampleSpacingPx: 2.6,
        minVisibleRun: 1,
        maxHiddenGap: 2,
        trimRatio: 0.01,
        trimPixelCap: 0.018,
        minPixelLength: 0.9
      }
      : {
        minVisibleRun: 1,
        maxHiddenGap: 3,
        trimRatio: 0.02,
        trimPixelCap: 0.035,
        minPixelLength: 0.5
      }
  });
  const shaderOcclusion = occludeLayer(layers.shader, depthBuffer, sampleDebug, {
    clip: fastMode
      ? {
        minSamples: 5,
        sampleSpacingPx: 2.8
      }
      : {}
  });
  const occluded = {
    outline: outlineOcclusion.strokes,
    internal: internalOcclusion.strokes,
    shader: shaderOcclusion.strokes
  };

  if (showDebug && controls.shaderPreset !== "off") {
    // eslint-disable-next-line no-console
    console.debug("shader", {
      preset: controls.shaderPreset,
      facesShaded: shaderDebug.facesShaded,
      cellsTested: shaderDebug.cellsTested,
      strokesBeforeClip: shaderDebug.emittedPostClip,
      strokesAfterOcclusion: shaderOcclusion.strokes.length
    });
  }
  const segmentsBeforeMerge = (outlineOcclusion.debug?.segmentsBefore || 0) + (internalOcclusion.debug?.segmentsBefore || 0);
  const segmentsAfterMerge = (outlineOcclusion.debug?.segmentsAfter || 0) + (internalOcclusion.debug?.segmentsAfter || 0);
  const removedMicroSegments = (outlineOcclusion.debug?.removedMicroSegments || 0) + (internalOcclusion.debug?.removedMicroSegments || 0);
  const preMergeEdges = showDebug
    ? [
      ...(outlineOcclusion.debug?.preMerge || []),
      ...(internalOcclusion.debug?.preMerge || [])
    ]
    : [];
  const postMergeEdges = showDebug
    ? [
      ...(outlineOcclusion.debug?.postMerge || []),
      ...(internalOcclusion.debug?.postMerge || [])
    ]
    : [];
  const endpointClusterMarkers = showDebug
    ? [
      ...(outlineOcclusion.debug?.endpointClusters || []),
      ...(internalOcclusion.debug?.endpointClusters || [])
    ]
      .slice(0, 1200)
      .map((cluster) => sampleMarker(cluster, 0.12))
    : [];

  const passSamples = showDebug && sampleDebug
    ? sampleDebug.filter((item) => item.visible).slice(0, 900).map((item) => sampleMarker(item.point))
    : [];
  const failSamples = showDebug && sampleDebug
    ? sampleDebug.filter((item) => !item.visible).slice(0, 900).map((item) => sampleMarker(item.point))
    : [];

  const debug = showDebug
    ? {
      occlusion: {
        faceOrder: faces.map((face) => ({
          id: face.id,
          drawOrder: face.drawOrder,
          minDepth: face.minDepth,
          avgDepth: face.depth,
          maxDepth: face.maxDepth
        })),
        edgeSilhouette: edges
          .filter((edge) => edge.classification === "silhouette")
          .map((edge) => ({ points: [edge.a, edge.b], closed: false })),
        edgeInternal: edges
          .filter((edge) => edge.classification === "internal")
          .map((edge) => ({ points: [edge.a, edge.b], closed: false })),
        faceBoxes: faces.map(faceBoundsStroke),
        faceLabels: faces.map(faceLabel),
        edgePreMerge: preMergeEdges,
        edgePostMerge: postMergeEdges,
        endpointClusters: endpointClusterMarkers,
        segmentStats: {
          before: segmentsBeforeMerge,
          after: segmentsAfterMerge,
          removedMicro: removedMicroSegments
        },
        samplePass: passSamples,
        sampleFail: failSamples,
        depthPreview: depthBuffer?.depthPreview || []
      }
    }
    : null;

  return {
    faces,
    layers: {
      outline: stripDepth(occluded.outline),
      internal: stripDepth(occluded.internal),
      shader: stripDepth(occluded.shader)
    },
    stats: {
      faceCount: faces.length,
      totalStrokes: budget.used,
      clippedStrokes: budget.clipped,
      outlineStrokes: occluded.outline.length,
      internalStrokes: occluded.internal.length,
      shaderStrokes: occluded.shader.length
    },
    debug
  };
}
