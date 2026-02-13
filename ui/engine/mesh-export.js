import { VoxelGrid } from "./grid.js";

function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return Number(value.toFixed(6)).toString();
}

function subtract3(a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z
  };
}

function cross3(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
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

function triangleArea2(a, b, c) {
  const ab = subtract3(b, a);
  const ac = subtract3(c, a);
  const cross = cross3(ab, ac);
  return dot3(cross, cross);
}

function orientedTriangle(a, b, c, normal) {
  const ab = subtract3(b, a);
  const ac = subtract3(c, a);
  const winding = cross3(ab, ac);
  if (dot3(winding, normal) < 0) {
    return [a, c, b];
  }
  return [a, b, c];
}

function keyForVertex(vertex, eps = 1e-8) {
  const inv = 1 / eps;
  const x = Math.round(vertex.x * inv);
  const y = Math.round(vertex.y * inv);
  const z = Math.round(vertex.z * inv);
  return `${x},${y},${z}`;
}

function keyForEdge(a, b, eps = 1e-8) {
  const ka = keyForVertex(a, eps);
  const kb = keyForVertex(b, eps);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function keyForTriangle(vertices, eps = 1e-8) {
  const keys = vertices.map((v) => keyForVertex(v, eps)).sort();
  return keys.join("|");
}

function addQuadTriangles(triangles, normal, p0, p1, p2, p3, voxelSize) {
  const n = normalize3(normal);
  const quad = [p0, p1, p2, p3].map((p) => ({
    x: p.x * voxelSize,
    y: p.y * voxelSize,
    z: p.z * voxelSize
  }));
  const first = orientedTriangle(quad[0], quad[1], quad[2], n);
  const second = orientedTriangle(quad[0], quad[2], quad[3], n);
  triangles.push({ normal: n, vertices: first });
  triangles.push({ normal: n, vertices: second });
}

function buildTrianglesFromGrid(grid, voxelSize) {
  const triangles = [];
  if (!grid) {
    return triangles;
  }

  grid.forEachOccupied((x, y, z) => {
    if (!grid.get(x + 1, y, z)) {
      addQuadTriangles(
        triangles,
        { x: 1, y: 0, z: 0 },
        { x: x + 1, y, z },
        { x: x + 1, y: y + 1, z },
        { x: x + 1, y: y + 1, z: z + 1 },
        { x: x + 1, y, z: z + 1 },
        voxelSize
      );
    }

    if (!grid.get(x - 1, y, z)) {
      addQuadTriangles(
        triangles,
        { x: -1, y: 0, z: 0 },
        { x, y, z },
        { x, y, z: z + 1 },
        { x, y: y + 1, z: z + 1 },
        { x, y: y + 1, z },
        voxelSize
      );
    }

    if (!grid.get(x, y + 1, z)) {
      addQuadTriangles(
        triangles,
        { x: 0, y: 1, z: 0 },
        { x, y: y + 1, z },
        { x, y: y + 1, z: z + 1 },
        { x: x + 1, y: y + 1, z: z + 1 },
        { x: x + 1, y: y + 1, z },
        voxelSize
      );
    }

    if (!grid.get(x, y - 1, z)) {
      addQuadTriangles(
        triangles,
        { x: 0, y: -1, z: 0 },
        { x, y, z },
        { x: x + 1, y, z },
        { x: x + 1, y, z: z + 1 },
        { x, y, z: z + 1 },
        voxelSize
      );
    }

    if (!grid.get(x, y, z + 1)) {
      addQuadTriangles(
        triangles,
        { x: 0, y: 0, z: 1 },
        { x, y, z: z + 1 },
        { x: x + 1, y, z: z + 1 },
        { x: x + 1, y: y + 1, z: z + 1 },
        { x, y: y + 1, z: z + 1 },
        voxelSize
      );
    }

    if (!grid.get(x, y, z - 1)) {
      addQuadTriangles(
        triangles,
        { x: 0, y: 0, z: -1 },
        { x, y, z },
        { x, y: y + 1, z },
        { x: x + 1, y: y + 1, z },
        { x: x + 1, y, z },
        voxelSize
      );
    }
  });

  return triangles;
}

function cloneGrid(grid) {
  const copy = new VoxelGrid(grid.width, grid.depth, grid.height);
  copy.data.set(grid.data);
  return copy;
}

function queueFill(cells, x, y, z) {
  cells.add(`${x},${y},${z}`);
}

function resolveDiagonalEdgeContactsPass(grid) {
  const fillCells = new Set();

  // Edges parallel to Z: inspect 2x2 neighborhoods in XY for each Z slice.
  for (let z = 0; z < grid.height; z += 1) {
    for (let x = 1; x < grid.width; x += 1) {
      for (let y = 1; y < grid.depth; y += 1) {
        const a = grid.get(x - 1, y - 1, z);
        const b = grid.get(x, y - 1, z);
        const c = grid.get(x - 1, y, z);
        const d = grid.get(x, y, z);
        if (a && d && !b && !c) {
          queueFill(fillCells, x, y - 1, z);
          queueFill(fillCells, x - 1, y, z);
        } else if (b && c && !a && !d) {
          queueFill(fillCells, x - 1, y - 1, z);
          queueFill(fillCells, x, y, z);
        }
      }
    }
  }

  // Edges parallel to X: inspect 2x2 neighborhoods in YZ for each X slice.
  for (let x = 0; x < grid.width; x += 1) {
    for (let y = 1; y < grid.depth; y += 1) {
      for (let z = 1; z < grid.height; z += 1) {
        const a = grid.get(x, y - 1, z - 1);
        const b = grid.get(x, y, z - 1);
        const c = grid.get(x, y - 1, z);
        const d = grid.get(x, y, z);
        if (a && d && !b && !c) {
          queueFill(fillCells, x, y, z - 1);
          queueFill(fillCells, x, y - 1, z);
        } else if (b && c && !a && !d) {
          queueFill(fillCells, x, y - 1, z - 1);
          queueFill(fillCells, x, y, z);
        }
      }
    }
  }

  // Edges parallel to Y: inspect 2x2 neighborhoods in XZ for each Y slice.
  for (let y = 0; y < grid.depth; y += 1) {
    for (let x = 1; x < grid.width; x += 1) {
      for (let z = 1; z < grid.height; z += 1) {
        const a = grid.get(x - 1, y, z - 1);
        const b = grid.get(x, y, z - 1);
        const c = grid.get(x - 1, y, z);
        const d = grid.get(x, y, z);
        if (a && d && !b && !c) {
          queueFill(fillCells, x, y, z - 1);
          queueFill(fillCells, x - 1, y, z);
        } else if (b && c && !a && !d) {
          queueFill(fillCells, x - 1, y, z - 1);
          queueFill(fillCells, x, y, z);
        }
      }
    }
  }

  let applied = 0;
  for (const cell of fillCells) {
    const [x, y, z] = cell.split(",").map((value) => Number(value));
    if (!grid.get(x, y, z)) {
      grid.set(x, y, z, true);
      applied += 1;
    }
  }
  return applied;
}

function repairDiagonalEdgeContacts(grid, maxPasses = 6) {
  let totalFilled = 0;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const applied = resolveDiagonalEdgeContactsPass(grid);
    if (!applied) {
      return {
        passes: pass,
        filled: totalFilled
      };
    }
    totalFilled += applied;
  }
  return {
    passes: maxPasses,
    filled: totalFilled
  };
}

function fillEnclosedVoids(grid) {
  const visited = new Uint8Array(grid.data.length);
  const queue = [];
  const neighbors = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1]
  ];

  const enqueueIfExteriorAir = (x, y, z) => {
    if (!grid.inBounds(x, y, z) || grid.get(x, y, z)) {
      return;
    }
    const index = grid.index(x, y, z);
    if (visited[index]) {
      return;
    }
    visited[index] = 1;
    queue.push([x, y, z]);
  };

  for (let x = 0; x < grid.width; x += 1) {
    for (let y = 0; y < grid.depth; y += 1) {
      enqueueIfExteriorAir(x, y, 0);
      enqueueIfExteriorAir(x, y, grid.height - 1);
    }
  }
  for (let x = 0; x < grid.width; x += 1) {
    for (let z = 0; z < grid.height; z += 1) {
      enqueueIfExteriorAir(x, 0, z);
      enqueueIfExteriorAir(x, grid.depth - 1, z);
    }
  }
  for (let y = 0; y < grid.depth; y += 1) {
    for (let z = 0; z < grid.height; z += 1) {
      enqueueIfExteriorAir(0, y, z);
      enqueueIfExteriorAir(grid.width - 1, y, z);
    }
  }

  for (let i = 0; i < queue.length; i += 1) {
    const [x, y, z] = queue[i];
    for (const [dx, dy, dz] of neighbors) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (!grid.inBounds(nx, ny, nz) || grid.get(nx, ny, nz)) {
        continue;
      }
      const index = grid.index(nx, ny, nz);
      if (visited[index]) {
        continue;
      }
      visited[index] = 1;
      queue.push([nx, ny, nz]);
    }
  }

  let filled = 0;
  for (let z = 0; z < grid.height; z += 1) {
    for (let y = 0; y < grid.depth; y += 1) {
      for (let x = 0; x < grid.width; x += 1) {
        if (grid.get(x, y, z)) {
          continue;
        }
        const index = grid.index(x, y, z);
        if (!visited[index]) {
          grid.set(x, y, z, true);
          filled += 1;
        }
      }
    }
  }

  return filled;
}

function countVoxelComponents(grid) {
  if (!grid) {
    return 0;
  }
  const visited = new Uint8Array(grid.data.length);
  let componentCount = 0;
  const neighbors = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1]
  ];

  grid.forEachOccupied((sx, sy, sz) => {
    const startIndex = grid.index(sx, sy, sz);
    if (visited[startIndex]) {
      return;
    }
    componentCount += 1;
    const queue = [[sx, sy, sz]];
    visited[startIndex] = 1;
    for (let i = 0; i < queue.length; i += 1) {
      const [x, y, z] = queue[i];
      for (const [dx, dy, dz] of neighbors) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (!grid.inBounds(nx, ny, nz) || !grid.get(nx, ny, nz)) {
          continue;
        }
        const index = grid.index(nx, ny, nz);
        if (visited[index]) {
          continue;
        }
        visited[index] = 1;
        queue.push([nx, ny, nz]);
      }
    }
  });
  return componentCount;
}

export function validateTriangleMesh(triangles, options = {}) {
  const eps = options.eps ?? 1e-8;
  const edgeMap = new Map();
  const faceMap = new Set();
  const degenerate = new Set();
  const duplicateFaces = new Set();

  for (let i = 0; i < triangles.length; i += 1) {
    const triangle = triangles[i];
    const [a, b, c] = triangle.vertices;
    if (triangleArea2(a, b, c) <= eps) {
      degenerate.add(i);
      continue;
    }

    const faceKey = keyForTriangle(triangle.vertices, eps);
    if (faceMap.has(faceKey)) {
      duplicateFaces.add(i);
      continue;
    }
    faceMap.add(faceKey);

    const edges = [[a, b], [b, c], [c, a]];
    for (const [start, end] of edges) {
      const edgeKey = keyForEdge(start, end, eps);
      const list = edgeMap.get(edgeKey) || [];
      list.push(i);
      edgeMap.set(edgeKey, list);
    }
  }

  const invalidEdgeKeys = [];
  for (const [edgeKey, faces] of edgeMap.entries()) {
    if (faces.length !== 2) {
      invalidEdgeKeys.push(edgeKey);
    }
  }

  const adjacency = new Map();
  for (let i = 0; i < triangles.length; i += 1) {
    adjacency.set(i, []);
  }
  for (const faces of edgeMap.values()) {
    if (faces.length < 2) {
      continue;
    }
    for (let i = 0; i < faces.length; i += 1) {
      for (let j = i + 1; j < faces.length; j += 1) {
        adjacency.get(faces[i]).push(faces[j]);
        adjacency.get(faces[j]).push(faces[i]);
      }
    }
  }

  const visited = new Uint8Array(triangles.length);
  let connectedComponents = 0;
  for (let i = 0; i < triangles.length; i += 1) {
    if (visited[i] || degenerate.has(i) || duplicateFaces.has(i)) {
      continue;
    }
    connectedComponents += 1;
    const queue = [i];
    visited[i] = 1;
    for (let q = 0; q < queue.length; q += 1) {
      const current = queue[q];
      for (const next of adjacency.get(current) || []) {
        if (visited[next]) {
          continue;
        }
        visited[next] = 1;
        queue.push(next);
      }
    }
  }

  const isClosed = invalidEdgeKeys.length === 0;
  const isSingleComponent = connectedComponents === 1 || triangles.length === 0;
  const isManifold = isClosed && degenerate.size === 0 && duplicateFaces.size === 0;

  return {
    triangleCount: triangles.length,
    edgeCount: edgeMap.size,
    nonManifoldEdgeCount: invalidEdgeKeys.length,
    degenerateFaceCount: degenerate.size,
    duplicateFaceCount: duplicateFaces.size,
    connectedComponents,
    isClosed,
    isSingleComponent,
    isManifold,
    invalidEdgeKeys
  };
}

function serializeAsciiStl(safeName, triangles) {
  const lines = [`solid ${safeName}`];
  for (const triangle of triangles) {
    const normal = triangle.normal;
    lines.push(`  facet normal ${formatNumber(normal.x)} ${formatNumber(normal.y)} ${formatNumber(normal.z)}`);
    lines.push("    outer loop");
    for (const vertex of triangle.vertices) {
      lines.push(`      vertex ${formatNumber(vertex.x)} ${formatNumber(vertex.y)} ${formatNumber(vertex.z)}`);
    }
    lines.push("    endloop");
    lines.push("  endfacet");
  }
  lines.push(`endsolid ${safeName}`);
  return `${lines.join("\n")}\n`;
}

export function buildExportStlFromGrid(grid, options = {}) {
  if (!grid) {
    throw new Error("STL mesh validation failed: missing voxel grid.");
  }
  const safeName = String(options.name || "sculpture").replace(/[^\w.-]+/g, "_");
  const voxelSize = Math.max(0.001, Number(options.voxelSize) || 1);
  const workingGrid = cloneGrid(grid);
  const repairPasses = options.repairPasses ?? 6;
  const repairSummaryA = repairDiagonalEdgeContacts(workingGrid, repairPasses);
  const enclosedVoidsFilled = fillEnclosedVoids(workingGrid);
  const repairSummaryB = repairDiagonalEdgeContacts(workingGrid, repairPasses);
  const repairedVoxels = repairSummaryA.filled + repairSummaryB.filled;
  const repairIterations = repairSummaryA.passes + repairSummaryB.passes;

  const triangles = buildTrianglesFromGrid(workingGrid, voxelSize);
  const report = validateTriangleMesh(triangles, { eps: 1e-8 });
  const voxelComponents = countVoxelComponents(workingGrid);
  const isSingleVoxelComponent = voxelComponents <= 1;

  if (!report.isManifold || !report.isSingleComponent || !isSingleVoxelComponent) {
    const summary = [
      `triangles=${report.triangleCount}`,
      `edges=${report.edgeCount}`,
      `nonManifoldEdges=${report.nonManifoldEdgeCount}`,
      `degenerate=${report.degenerateFaceCount}`,
      `duplicateFaces=${report.duplicateFaceCount}`,
      `meshComponents=${report.connectedComponents}`,
      `voxelComponents=${voxelComponents}`
    ].join(" ");
    throw new Error(`STL mesh validation failed: ${summary}`);
  }

  return {
    stl: serializeAsciiStl(safeName, triangles),
    triangleCount: triangles.length,
    report: {
      ...report,
      voxelComponents,
      repairedVoxels,
      repairPasses: repairIterations,
      enclosedVoidsFilled
    }
  };
}

// Legacy helper retained for compatibility with older paths.
export function buildExportStl(faces, options = {}) {
  const safeName = String(options.name || "sculpture").replace(/[^\w.-]+/g, "_");
  const voxelSize = Math.max(0.001, Number(options.voxelSize) || 1);
  const triangles = [];
  for (const face of faces || []) {
    const corners = Array.isArray(face?.corners) ? face.corners : [];
    if (corners.length < 3) {
      continue;
    }
    const normal = normalize3(face?.normal || { x: 0, y: 0, z: 1 });
    const points = corners.map((corner) => ({
      x: Number(corner.x || 0) * voxelSize,
      y: Number(corner.y || 0) * voxelSize,
      z: Number(corner.z || 0) * voxelSize
    }));
    for (let i = 1; i < points.length - 1; i += 1) {
      const oriented = orientedTriangle(points[0], points[i], points[i + 1], normal);
      triangles.push({ normal, vertices: oriented });
    }
  }
  return {
    stl: serializeAsciiStl(safeName, triangles),
    triangleCount: triangles.length,
    report: validateTriangleMesh(triangles)
  };
}
