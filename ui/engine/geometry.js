const EPS = 1e-6;

export function dot2(a, b) {
  return a.x * b.x + a.y * b.y;
}

export function cross2(a, b) {
  return a.x * b.y - a.y * b.x;
}

export function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += distance(points[i - 1], points[i]);
  }
  return total;
}

export function lerpPoint(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t
  };
}

export function pointInPolygon(point, polygon) {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersect = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + EPS) + xi;
    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}

export function polygonCentroid(polygon) {
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;

  for (let i = 0; i < polygon.length; i += 1) {
    const j = (i + 1) % polygon.length;
    const cross = polygon[i].x * polygon[j].y - polygon[j].x * polygon[i].y;
    twiceArea += cross;
    cx += (polygon[i].x + polygon[j].x) * cross;
    cy += (polygon[i].y + polygon[j].y) * cross;
  }

  if (Math.abs(twiceArea) < EPS) {
    const sum = polygon.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
    return { x: sum.x / polygon.length, y: sum.y / polygon.length };
  }

  const factor = 1 / (3 * twiceArea);
  return {
    x: cx * factor,
    y: cy * factor
  };
}

export function boundsFromPolygons(polygons) {
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

  if (!Number.isFinite(minX)) {
    return {
      minX: 0,
      minY: 0,
      maxX: 1,
      maxY: 1,
      width: 1,
      height: 1
    };
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
}

function intersectInfiniteLineWithSegment(linePoint, lineDir, a, b) {
  const segmentDir = { x: b.x - a.x, y: b.y - a.y };
  const denominator = cross2(lineDir, segmentDir);

  if (Math.abs(denominator) < EPS) {
    return null;
  }

  const fromLineToA = { x: a.x - linePoint.x, y: a.y - linePoint.y };
  const t = cross2(fromLineToA, segmentDir) / denominator;
  const u = cross2(fromLineToA, lineDir) / denominator;

  if (u < -EPS || u > 1 + EPS) {
    return null;
  }

  return {
    t,
    point: {
      x: linePoint.x + lineDir.x * t,
      y: linePoint.y + lineDir.y * t
    }
  };
}

export function clipInfiniteLineToPolygon(linePoint, lineDir, polygon) {
  const intersections = [];

  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const hit = intersectInfiniteLineWithSegment(linePoint, lineDir, a, b);
    if (hit) {
      intersections.push(hit);
    }
  }

  intersections.sort((left, right) => left.t - right.t);

  const unique = [];
  for (const hit of intersections) {
    const previous = unique[unique.length - 1];
    if (!previous || Math.abs(hit.t - previous.t) > 1e-4) {
      unique.push(hit);
    }
  }

  if (unique.length < 2) {
    return null;
  }

  return [unique[0].point, unique[unique.length - 1].point];
}

function intersectSegmentsWithT(a0, a1, b0, b1) {
  const r = { x: a1.x - a0.x, y: a1.y - a0.y };
  const s = { x: b1.x - b0.x, y: b1.y - b0.y };
  const denominator = cross2(r, s);

  if (Math.abs(denominator) < EPS) {
    return null;
  }

  const qp = { x: b0.x - a0.x, y: b0.y - a0.y };
  const t = cross2(qp, s) / denominator;
  const u = cross2(qp, r) / denominator;

  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) {
    return null;
  }

  return {
    t,
    point: {
      x: a0.x + r.x * t,
      y: a0.y + r.y * t
    }
  };
}

export function clipSegmentToPolygon(start, end, polygon) {
  const cuts = [0, 1];

  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const intersection = intersectSegmentsWithT(start, end, a, b);

    if (intersection) {
      cuts.push(intersection.t);
    }
  }

  cuts.sort((left, right) => left - right);

  const unique = [];
  for (const value of cuts) {
    if (!unique.length || Math.abs(value - unique[unique.length - 1]) > 1e-4) {
      unique.push(value);
    }
  }

  const segments = [];

  for (let i = 0; i < unique.length - 1; i += 1) {
    const t0 = unique[i];
    const t1 = unique[i + 1];

    if (t1 - t0 < 1e-4) {
      continue;
    }

    const mid = lerpPoint(start, end, (t0 + t1) * 0.5);
    if (!pointInPolygon(mid, polygon)) {
      continue;
    }

    segments.push([lerpPoint(start, end, t0), lerpPoint(start, end, t1)]);
  }

  return segments;
}