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

function fixedFaceType(normal) {
  if (normal.z > 0.55) {
    return "top";
  }

  const isoX = normal.x - normal.y;
  return isoX >= 0 ? "right" : "left";
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
    return { visible: false, faceType: "none", shadeKey: "none" };
  }

  return { visible: true, faceType: fixedFaceType(normal), shadeKey: fixedShadeKey(normal) };
}

export function projectFaces(faces, view, options = {}) {
  const fastOrder = Boolean(options.fastOrder);
  const visibleFaces = [];

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

    visibleFaces.push({
      id: face.id,
      faceType: classification.faceType,
      shadeKey: classification.shadeKey,
      area: face.area,
      normal: { ...face.normal },
      worldCorners,
      points3,
      points,
      depth,
      minDepth,
      maxDepth
    });
  }

  const ordered = fastOrder
    ? visibleFaces.sort(fallbackCompare)
    : depthAwareOrder(visibleFaces);
  for (let i = 0; i < ordered.length; i += 1) {
    ordered[i].drawOrder = i;
  }
  return ordered;
}
