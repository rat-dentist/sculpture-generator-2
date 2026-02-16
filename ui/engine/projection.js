const EPS = 1e-6;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

function applyOrientation(point, orientation) {
  return {
    x: orientation[0] * point.x + orientation[1] * point.y + orientation[2] * point.z,
    y: orientation[3] * point.x + orientation[4] * point.y + orientation[5] * point.z,
    z: orientation[6] * point.x + orientation[7] * point.y + orientation[8] * point.z
  };
}

function quantized(value, eps = 1e-4) {
  return Math.round(value / eps) * eps;
}

function dot3(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function normalize3(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length
  };
}

function rotateScreenHorizontal(point, pitchRadians) {
  const axis = {
    x: Math.SQRT1_2,
    y: -Math.SQRT1_2,
    z: 0
  };
  const cos = Math.cos(pitchRadians);
  const sin = Math.sin(pitchRadians);
  const dot = point.x * axis.x + point.y * axis.y + point.z * axis.z;
  const cross = {
    x: axis.y * point.z - axis.z * point.y,
    y: axis.z * point.x - axis.x * point.z,
    z: axis.x * point.y - axis.y * point.x
  };

  return {
    x: point.x * cos + cross.x * sin + axis.x * dot * (1 - cos),
    y: point.y * cos + cross.y * sin + axis.y * dot * (1 - cos),
    z: point.z * cos + cross.z * sin + axis.z * dot * (1 - cos)
  };
}

function rotateView(point, view) {
  const pivot = view.pivot || { x: 0, y: 0, z: 0 };
  const local = {
    x: point.x - pivot.x,
    y: point.y - pivot.y,
    z: point.z - pivot.z
  };
  if (Array.isArray(view.orientation) && view.orientation.length === 9) {
    return applyOrientation(local, view.orientation);
  }
  const yaw = (view.yawDeg * Math.PI) / 180;
  const pitch = ((view.pitchDeg || 0) * Math.PI) / 180;
  const yawed = rotateXY(local, yaw);
  return rotateScreenHorizontal(yawed, pitch);
}

function rotateViewVector(vector, view) {
  if (Array.isArray(view.orientation) && view.orientation.length === 9) {
    return applyOrientation(vector, view.orientation);
  }
  const yaw = (view.yawDeg * Math.PI) / 180;
  const pitch = ((view.pitchDeg || 0) * Math.PI) / 180;
  const yawed = rotateXY(vector, yaw);
  return rotateScreenHorizontal(yawed, pitch);
}

function fixedFaceType(rotatedNormal) {
  if (rotatedNormal.z > 0.5) {
    return "top";
  }

  const isoX = rotatedNormal.x - rotatedNormal.y;
  return isoX >= 0 ? "right" : "left";
}

function stableFaceTypeFromShadeKey(shadeKey) {
  if (shadeKey === "z_pos") {
    return "top";
  }
  if (shadeKey === "x_pos" || shadeKey === "y_neg") {
    return "right";
  }
  return "left";
}

function fixedShadeKey(normal) {
  if (normal.z > 0.5) {
    return "z_pos";
  }
  if (normal.z < -0.5) {
    return "z_neg";
  }
  if (normal.x > 0.5) {
    return "x_pos";
  }
  if (normal.x < -0.5) {
    return "x_neg";
  }
  if (normal.y > 0.5) {
    return "y_pos";
  }
  return "y_neg";
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

const LIGHTS = [
  { dir: normalize3({ x: 0.32, y: -0.54, z: 0.78 }), weight: 0.6 },
  { dir: normalize3({ x: -0.42, y: 0.24, z: 0.46 }), weight: 0.28 },
  { dir: normalize3({ x: 0.12, y: 0.08, z: -0.98 }), weight: 0.12 }
];

function toneIndexFromLighting(normal, shadeKey) {
  const orientationTone = toneIndexFromShadeKey(shadeKey);
  return orientationTone;
}

export function toneIndexForFace(face) {
  if (Number.isFinite(face?.toneIndex)) {
    return Math.max(0, Math.min(5, Math.round(face.toneIndex)));
  }
  return toneIndexFromShadeKey(face?.shadeKey);
}

export function tone01ForFace(face) {
  return toneIndexForFace(face) / 5;
}

function faceBounds(face) {
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

  return { minX, minY, maxX, maxY };
}

function boundsOverlap(a, b, eps = 1e-6) {
  if (a.maxX < b.minX + eps || b.maxX < a.minX + eps) {
    return false;
  }
  if (a.maxY < b.minY + eps || b.maxY < a.minY + eps) {
    return false;
  }
  return true;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersects = yi > point.y !== yj > point.y
      && point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-9) + xi;
    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function edgeCross(a, b, c) {
  return (c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x);
}

function segmentIntersection(a0, a1, b0, b1) {
  const r = { x: a1.x - a0.x, y: a1.y - a0.y };
  const s = { x: b1.x - b0.x, y: b1.y - b0.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-8) {
    return null;
  }

  const qp = { x: b0.x - a0.x, y: b0.y - a0.y };
  const t = (qp.x * s.y - qp.y * s.x) / denom;
  const u = (qp.x * r.y - qp.y * r.x) / denom;

  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) {
    return null;
  }

  return {
    x: a0.x + r.x * t,
    y: a0.y + r.y * t
  };
}

function uniquePoints(points, eps = 1e-3) {
  const unique = [];
  for (const point of points) {
    const exists = unique.some((item) => Math.hypot(item.x - point.x, item.y - point.y) <= eps);
    if (!exists) {
      unique.push(point);
    }
  }
  return unique;
}

function overlapSamples(faceA, faceB) {
  const samples = [];

  for (const point of faceA.points) {
    if (pointInPolygon(point, faceB.points)) {
      samples.push(point);
    }
  }

  for (const point of faceB.points) {
    if (pointInPolygon(point, faceA.points)) {
      samples.push(point);
    }
  }

  for (let i = 0; i < faceA.points.length; i += 1) {
    const a0 = faceA.points[i];
    const a1 = faceA.points[(i + 1) % faceA.points.length];
    for (let j = 0; j < faceB.points.length; j += 1) {
      const b0 = faceB.points[j];
      const b1 = faceB.points[(j + 1) % faceB.points.length];
      const hit = segmentIntersection(a0, a1, b0, b1);
      if (hit) {
        samples.push(hit);
      }
    }
  }

  return uniquePoints(samples);
}

function depthPlane(face) {
  if (!face.points3 || face.points3.length < 3) {
    return null;
  }

  const p0 = face.points3[0];
  const p1 = face.points3[1];
  const p2 = face.points3[2];

  const den = p0.x * (p1.y - p2.y) + p1.x * (p2.y - p0.y) + p2.x * (p0.y - p1.y);
  if (Math.abs(den) < 1e-8) {
    return null;
  }

  const a = (p0.depth * (p1.y - p2.y) + p1.depth * (p2.y - p0.y) + p2.depth * (p0.y - p1.y)) / den;
  const b = (p0.depth * (p2.x - p1.x) + p1.depth * (p0.x - p2.x) + p2.depth * (p1.x - p0.x)) / den;
  const c = (p0.depth * (p1.x * p2.y - p2.x * p1.y)
    + p1.depth * (p2.x * p0.y - p0.x * p2.y)
    + p2.depth * (p0.x * p1.y - p1.x * p0.y)) / den;

  return { a, b, c };
}

function depthAt(face, point) {
  if (!face.depthPlane) {
    return face.depth;
  }
  return face.depthPlane.a * point.x + face.depthPlane.b * point.y + face.depthPlane.c;
}

function fallbackCompare(a, b) {
  if (Math.abs(a.depth - b.depth) > 1e-6) {
    return a.depth - b.depth;
  }
  if (Math.abs(a.maxDepth - b.maxDepth) > 1e-6) {
    return a.maxDepth - b.maxDepth;
  }
  return a.id - b.id;
}

function depthAwareOrder(faces) {
  if (faces.length <= 1) {
    return faces;
  }

  for (const face of faces) {
    face.bounds = faceBounds(face);
    face.depthPlane = depthPlane(face);
  }

  const adjacency = new Map();
  const indegree = new Map();
  for (const face of faces) {
    adjacency.set(face.id, new Set());
    indegree.set(face.id, 0);
  }

  for (let i = 0; i < faces.length; i += 1) {
    const a = faces[i];
    for (let j = i + 1; j < faces.length; j += 1) {
      const b = faces[j];
      if (!boundsOverlap(a.bounds, b.bounds)) {
        continue;
      }

      const samples = overlapSamples(a, b);
      if (!samples.length) {
        continue;
      }

      let aFront = 0;
      let bFront = 0;

      for (const sample of samples) {
        const da = depthAt(a, sample);
        const db = depthAt(b, sample);
        if (da > db + 1e-4) {
          aFront += 1;
        } else if (db > da + 1e-4) {
          bFront += 1;
        }
      }

      if (aFront && bFront) {
        continue;
      }

      if (aFront > 0) {
        if (!adjacency.get(b.id).has(a.id)) {
          adjacency.get(b.id).add(a.id);
          indegree.set(a.id, indegree.get(a.id) + 1);
        }
      } else if (bFront > 0) {
        if (!adjacency.get(a.id).has(b.id)) {
          adjacency.get(a.id).add(b.id);
          indegree.set(b.id, indegree.get(b.id) + 1);
        }
      }
    }
  }

  const byId = new Map(faces.map((face) => [face.id, face]));
  const queue = faces.filter((face) => indegree.get(face.id) === 0).sort(fallbackCompare);
  const ordered = [];

  while (queue.length) {
    const next = queue.shift();
    ordered.push(next);

    for (const toId of adjacency.get(next.id)) {
      indegree.set(toId, indegree.get(toId) - 1);
      if (indegree.get(toId) === 0) {
        queue.push(byId.get(toId));
      }
    }

    queue.sort(fallbackCompare);
  }

  if (ordered.length !== faces.length) {
    const used = new Set(ordered.map((face) => face.id));
    const rest = faces.filter((face) => !used.has(face.id)).sort(fallbackCompare);
    ordered.push(...rest);
  }

  for (const face of ordered) {
    delete face.bounds;
    delete face.depthPlane;
  }

  return ordered;
}

export function projectPoint(point, view) {
  const rotated = rotateView(point, view);
  const x = (rotated.x - rotated.y) * view.scale;
  const y = (rotated.x + rotated.y) * 0.5 * view.scale - rotated.z * view.scale;
  const depth = rotated.x + rotated.y + rotated.z;

  return { x, y, depth };
}

function classifyFace(normal, view) {
  const rotatedNormal = rotateViewVector(normal, view);
  const facing = rotatedNormal.x + rotatedNormal.y + rotatedNormal.z;

  if (facing < -1e-4) {
    return {
      visible: false,
      faceType: "none",
      shadeKey: "none",
      toneIndex: 0,
      rotatedNormal
    };
  }

  const shadeKey = fixedShadeKey(normal);
  return {
    visible: true,
    faceType: stableFaceTypeFromShadeKey(shadeKey),
    shadeKey,
    toneIndex: toneIndexFromLighting(normal, shadeKey),
    rotatedNormal
  };
}

function edge2(a, b, c) {
  return (c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x);
}

function buildVisibilityContext(faces, options = {}) {
  if (!faces.length) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const face of faces) {
    for (const point of face.points || []) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }

  if (!Number.isFinite(minX)) {
    return null;
  }

  const boundsWidth = Math.max(1, maxX - minX);
  const boundsHeight = Math.max(1, maxY - minY);
  const maxDim = Math.max(320, Number(options.maxDim) || 1600);
  const maxScale = clamp(Number(options.maxScale ?? 3), 0.5, 4.5);
  const minScale = clamp(Number(options.minScale ?? 0.5), 0.2, maxScale);
  const scale = clamp(
    Math.min(maxDim / boundsWidth, maxDim / boundsHeight, maxScale),
    minScale,
    maxScale
  );

  const paddingPx = 3;
  const originX = minX - paddingPx / scale;
  const originY = minY - paddingPx / scale;
  const width = Math.max(16, Math.ceil(boundsWidth * scale) + paddingPx * 2 + 2);
  const height = Math.max(16, Math.ceil(boundsHeight * scale) + paddingPx * 2 + 2);
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
    const minTriX = Math.max(0, Math.floor(Math.min(v0.x, v1.x, v2.x)));
    const maxTriX = Math.min(width - 1, Math.ceil(Math.max(v0.x, v1.x, v2.x)));
    const minTriY = Math.max(0, Math.floor(Math.min(v0.y, v1.y, v2.y)));
    const maxTriY = Math.min(height - 1, Math.ceil(Math.max(v0.y, v1.y, v2.y)));

    const area = edge2(v0, v1, v2);
    if (Math.abs(area) < 1e-8) {
      return;
    }

    for (let y = minTriY; y <= maxTriY; y += 1) {
      for (let x = minTriX; x <= maxTriX; x += 1) {
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

  return {
    width,
    height,
    originX,
    originY,
    scale,
    depthBuffer,
    faceBuffer,
    depthPreview: []
  };
}

function buildDepthPreview(ctx) {
  if (!ctx) {
    return [];
  }

  let minDepth = Number.POSITIVE_INFINITY;
  let maxDepth = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < ctx.depthBuffer.length; i += 1) {
    const value = ctx.depthBuffer[i];
    if (!Number.isFinite(value) || value === Number.NEGATIVE_INFINITY) {
      continue;
    }
    minDepth = Math.min(minDepth, value);
    maxDepth = Math.max(maxDepth, value);
  }

  if (!Number.isFinite(minDepth) || !Number.isFinite(maxDepth) || maxDepth <= minDepth + 1e-6) {
    return [];
  }

  const previewW = Math.min(64, ctx.width);
  const previewH = Math.min(64, ctx.height);
  const sx = ctx.width / previewW;
  const sy = ctx.height / previewH;
  const cells = [];

  for (let py = 0; py < previewH; py += 1) {
    for (let px = 0; px < previewW; px += 1) {
      let sum = 0;
      let count = 0;

      const x0 = Math.floor(px * sx);
      const x1 = Math.min(ctx.width, Math.ceil((px + 1) * sx));
      const y0 = Math.floor(py * sy);
      const y1 = Math.min(ctx.height, Math.ceil((py + 1) * sy));

      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const value = ctx.depthBuffer[y * ctx.width + x];
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

  return [{ w: previewW, h: previewH, cells }];
}

function sampleVisibilityContext(ctx, point) {
  if (!ctx) {
    return { depth: Number.NEGATIVE_INFINITY, faceId: -1 };
  }

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

function distance3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function buildFaceMask(face, visibilityContext, options = {}) {
  const points = face.points || [];
  if (points.length < 3 || !visibilityContext) {
    return null;
  }

  const coarse = Boolean(options.coarse);
  const worldCorners = face.worldCorners || [];

  const origin = { x: points[0].x, y: points[0].y };
  const p1 = points[1] || points[0];
  const pLast = points[points.length - 1] || points[0];
  const uVec = { x: p1.x - origin.x, y: p1.y - origin.y };
  const vVec = { x: pLast.x - origin.x, y: pLast.y - origin.y };

  let uLen2D = Math.hypot(uVec.x, uVec.y);
  let vLen2D = Math.hypot(vVec.x, vVec.y);
  let det = uVec.x * vVec.y - uVec.y * vVec.x;

  if (Math.abs(det) < 1e-8 || uLen2D < 1e-5 || vLen2D < 1e-5) {
    const bounds = faceBounds(face);
    const fallbackU = { x: bounds.maxX - bounds.minX, y: 0 };
    const fallbackV = { x: 0, y: bounds.maxY - bounds.minY };
    uVec.x = fallbackU.x;
    uVec.y = fallbackU.y;
    vVec.x = fallbackV.x;
    vVec.y = fallbackV.y;
    uLen2D = Math.max(1e-5, Math.abs(fallbackU.x));
    vLen2D = Math.max(1e-5, Math.abs(fallbackV.y));
    det = Math.max(1e-5, uLen2D * vLen2D);
    origin.x = bounds.minX;
    origin.y = bounds.minY;
  }

  const worldU = worldCorners.length >= 2
    ? Math.max(1e-3, distance3(worldCorners[0], worldCorners[1]))
    : Math.max(1e-3, Math.sqrt(Math.max(1, face.area || 1)));
  const worldV = worldCorners.length >= 4
    ? Math.max(1e-3, distance3(worldCorners[0], worldCorners[worldCorners.length - 1]))
    : Math.max(1e-3, (face.area || 1) / worldU);

  const stepWorld = clamp(Number(options.maskStepWorld ?? (coarse ? 0.9 : 0.64)), 0.24, 2.4);
  const cols = clamp(Math.round(worldU / stepWorld), 4, coarse ? 80 : 160);
  const rows = clamp(Math.round(worldV / stepWorld), 4, coarse ? 80 : 160);
  const cells = new Uint8Array(rows * cols);
  const invDet = 1 / det;
  const depthEps = clamp(0.018 + 0.006 / Math.max(0.45, visibilityContext.scale), 0.012, 0.05);

  let tested = 0;
  let visibleCells = 0;
  let minU = 1;
  let minV = 1;
  let maxU = 0;
  let maxV = 0;

  for (let row = 0; row < rows; row += 1) {
    const v = (row + 0.5) / rows;
    for (let col = 0; col < cols; col += 1) {
      const u = (col + 0.5) / cols;
      const point = {
        x: origin.x + uVec.x * u + vVec.x * v,
        y: origin.y + uVec.y * u + vVec.y * v
      };

      if (!pointInPolygon(point, points)) {
        continue;
      }

      tested += 1;
      const depthAtPoint = depthAt(face, point);
      const sample = sampleVisibilityContext(visibilityContext, point);
      const visible = sample.faceId === face.id
        || (Number.isFinite(sample.depth) && Number.isFinite(depthAtPoint) && Math.abs(sample.depth - depthAtPoint) <= depthEps);

      if (!visible) {
        continue;
      }

      cells[row * cols + col] = 1;
      visibleCells += 1;
      minU = Math.min(minU, u);
      minV = Math.min(minV, v);
      maxU = Math.max(maxU, u);
      maxV = Math.max(maxV, v);
    }
  }

  const coverage = tested > 0 ? visibleCells / tested : 0;

  return {
    origin: { x: origin.x, y: origin.y },
    uX: uVec.x,
    uY: uVec.y,
    vX: vVec.x,
    vY: vVec.y,
    uLen2D,
    vLen2D,
    worldU,
    worldV,
    rows,
    cols,
    invDet,
    cells,
    tested,
    visibleCells,
    coverage,
    visibleBoundsUv: {
      minU,
      minV,
      maxU,
      maxV
    },
    sampleScale: Math.max(cols / Math.max(1e-5, uLen2D), rows / Math.max(1e-5, vLen2D))
  };
}

export function projectFaces(faces, view, options = {}) {
  const projectedFaces = [];

  for (const face of faces) {
    const classification = classifyFace(face.normal, view);
    if (!classification.visible) {
      continue;
    }

    const corners = face.corners || [];
    const points = new Array(corners.length);
    const points3 = new Array(corners.length);
    const worldCorners = new Array(corners.length);
    let depthSum = 0;
    let minDepth = Number.POSITIVE_INFINITY;
    let maxDepth = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < corners.length; i += 1) {
      const corner = corners[i];
      const point = projectPoint(corner, view);
      points[i] = { x: point.x, y: point.y };
      points3[i] = { x: point.x, y: point.y, depth: point.depth };
      worldCorners[i] = {
        x: quantized(corner.x),
        y: quantized(corner.y),
        z: quantized(corner.z)
      };
      depthSum += point.depth;
      minDepth = Math.min(minDepth, point.depth);
      maxDepth = Math.max(maxDepth, point.depth);
    }

    const depth = points.length ? depthSum / points.length : 0;

    projectedFaces.push({
      id: face.id,
      faceType: classification.faceType,
      shadeKey: classification.shadeKey,
      toneIndex: classification.toneIndex,
      area: face.area,
      normal: { ...face.normal },
      normalView: { ...classification.rotatedNormal },
      worldCorners,
      points3,
      points,
      depth,
      minDepth,
      maxDepth
    });
  }

  const depthOrdered = depthAwareOrder(projectedFaces);
  const visibilityContext = buildVisibilityContext(depthOrdered, {
    maxDim: options.coarseVisibility ? 980 : 1700,
    maxScale: options.coarseVisibility ? 2 : 3.2,
    minScale: options.coarseVisibility ? 0.32 : 0.45
  });

  const visibleFaces = [];
  for (const face of depthOrdered) {
    face.depthPlane = depthPlane(face);
    const visibleMask = buildFaceMask(face, visibilityContext, {
      coarse: options.coarseVisibility,
      maskStepWorld: options.maskStepWorld
    });
    face.visibleMask = visibleMask;
    face.visibleCoverage = Number(visibleMask?.coverage || 0);

    if ((visibleMask?.visibleCells || 0) <= 0) {
      continue;
    }

    visibleFaces.push(face);
  }

  const orderedVisible = depthAwareOrder(visibleFaces);
  for (let i = 0; i < orderedVisible.length; i += 1) {
    orderedVisible[i].drawOrder = i;
  }

  if (visibilityContext) {
    visibilityContext.depthPreview = options.includeDepthPreview
      ? buildDepthPreview(visibilityContext)
      : [];
  }

  return {
    faces: orderedVisible,
    visibilityContext
  };
}
