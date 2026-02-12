import { VoxelGrid } from "./grid.js";
import { createRng, randomFloat, randomInt } from "./random.js";

const NEIGHBORS_6 = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1]
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function withThemeDefaults(params) {
  return {
    ...params,
    erosionRate: params.erosionRate ?? 0.25,
    erosionClusterSize: params.erosionClusterSize ?? 16,
    greebleDensity: params.greebleDensity ?? 0.35,
    panelizationRate: params.panelizationRate ?? 0.4,
    ventRate: params.ventRate ?? 0.3,
    conduitRate: params.conduitRate ?? 0.3,
    asymmetry: params.asymmetry ?? 0.5,
    debugGeometry: Boolean(params.debugGeometry)
  };
}

function occupiedNeighbors(grid, x, y, z) {
  let count = 0;
  for (const [dx, dy, dz] of NEIGHBORS_6) {
    if (grid.get(x + dx, y + dy, z + dz)) {
      count += 1;
    }
  }
  return count;
}

function sampleFootprintHeight(grid, x, y, w, d) {
  let top = -1;
  for (let yy = y; yy < y + d; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) {
      top = Math.max(top, grid.highestAt(xx, yy));
    }
  }
  return top + 1;
}

function getComponents(grid) {
  const visited = new Uint8Array(grid.data.length);
  const components = [];

  grid.forEachOccupied((x, y, z) => {
    const startIndex = grid.index(x, y, z);
    if (visited[startIndex]) {
      return;
    }

    const queue = [[x, y, z]];
    visited[startIndex] = 1;
    const cells = [];

    for (let i = 0; i < queue.length; i += 1) {
      const [cx, cy, cz] = queue[i];
      cells.push([cx, cy, cz]);

      for (const [dx, dy, dz] of NEIGHBORS_6) {
        const nx = cx + dx;
        const ny = cy + dy;
        const nz = cz + dz;
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

    components.push(cells);
  });

  components.sort((a, b) => b.length - a.length);
  return components;
}

function isConnected(grid) {
  return getComponents(grid).length <= 1;
}

function pickRandomCell(cells, rng) {
  if (!cells.length) {
    return null;
  }
  return cells[randomInt(rng, 0, cells.length - 1)];
}

function connectComponents(grid, rng) {
  const components = getComponents(grid);
  if (components.length <= 1) {
    return;
  }

  const main = components[0];
  for (let i = 1; i < components.length; i += 1) {
    const a = pickRandomCell(main, rng);
    const b = pickRandomCell(components[i], rng);
    if (!a || !b) {
      continue;
    }

    let [x, y, z] = a;
    const [tx, ty, tz] = b;
    const beam = randomInt(rng, 1, 2);

    while (x !== tx) {
      x += tx > x ? 1 : -1;
      grid.fillCuboid(x, y, z, beam, beam, beam, true);
    }
    while (y !== ty) {
      y += ty > y ? 1 : -1;
      grid.fillCuboid(x, y, z, beam, beam, beam, true);
    }
    while (z !== tz) {
      z += tz > z ? 1 : -1;
      grid.fillCuboid(x, y, z, beam, beam, beam, true);
    }

    main.push(...components[i]);
  }
}

function wouldDisconnect(grid, x, y, z) {
  if (!grid.get(x, y, z)) {
    return false;
  }

  const neighborCount = occupiedNeighbors(grid, x, y, z);
  if (neighborCount <= 1) {
    return false;
  }

  const total = grid.countOccupied();
  if (total <= 2) {
    return true;
  }

  grid.set(x, y, z, false);

  let start = null;
  for (const [dx, dy, dz] of NEIGHBORS_6) {
    const nx = x + dx;
    const ny = y + dy;
    const nz = z + dz;
    if (grid.get(nx, ny, nz)) {
      start = [nx, ny, nz];
      break;
    }
  }

  if (!start) {
    grid.set(x, y, z, true);
    return true;
  }

  const visited = new Uint8Array(grid.data.length);
  const queue = [start];
  visited[grid.index(start[0], start[1], start[2])] = 1;
  let seen = 1;

  for (let i = 0; i < queue.length; i += 1) {
    const [cx, cy, cz] = queue[i];
    for (const [dx, dy, dz] of NEIGHBORS_6) {
      const nx = cx + dx;
      const ny = cy + dy;
      const nz = cz + dz;
      if (!grid.inBounds(nx, ny, nz) || !grid.get(nx, ny, nz)) {
        continue;
      }
      const index = grid.index(nx, ny, nz);
      if (visited[index]) {
        continue;
      }
      visited[index] = 1;
      seen += 1;
      queue.push([nx, ny, nz]);
    }
  }

  grid.set(x, y, z, true);
  return seen !== total - 1;
}

function getSurfaceVoxels(grid) {
  const surface = [];
  grid.forEachOccupied((x, y, z) => {
    let exposure = 0;
    let underside = false;
    let edgeBias = 0;

    for (const [dx, dy, dz] of NEIGHBORS_6) {
      if (!grid.get(x + dx, y + dy, z + dz)) {
        exposure += 1;
        if (dz === -1) {
          underside = true;
        }
      }
    }

    if (!exposure) {
      return;
    }

    if (x <= 1 || x >= grid.width - 2) {
      edgeBias += 1;
    }
    if (y <= 1 || y >= grid.depth - 2) {
      edgeBias += 1;
    }
    if (z <= 1 || z >= grid.height - 2) {
      edgeBias += 1;
    }

    surface.push({ x, y, z, exposure, underside, edgeBias });
  });
  return surface;
}

function addBaseMassing(grid, params, rng) {
  const plinthW = Math.max(2, Math.floor(params.width * randomFloat(rng, 0.28, 0.52)));
  const plinthD = Math.max(2, Math.floor(params.depth * randomFloat(rng, 0.28, 0.52)));
  const plinthX = randomInt(rng, 0, Math.max(0, params.width - plinthW));
  const plinthY = randomInt(rng, 0, Math.max(0, params.depth - plinthD));
  grid.fillCuboid(plinthX, plinthY, 0, plinthW, plinthD, 1, true);

  const primary = Math.max(2, params.massCount);
  for (let i = 0; i < primary; i += 1) {
    const w = randomInt(rng, Math.max(2, Math.floor(params.width * 0.2)), Math.max(3, Math.floor(params.width * 0.75)));
    const d = randomInt(rng, Math.max(2, Math.floor(params.depth * 0.2)), Math.max(3, Math.floor(params.depth * 0.75)));
    const h = randomInt(rng, Math.max(2, Math.floor(params.height * 0.22)), Math.max(3, Math.floor(params.height * 0.9)));
    const x = randomInt(rng, 0, Math.max(0, params.width - w));
    const y = randomInt(rng, 0, Math.max(0, params.depth - d));

    let z = i === 0 ? 0 : sampleFootprintHeight(grid, x, y, w, d);
    if (rng() < params.asymmetry) {
      z = Math.max(0, z - randomInt(rng, 0, 2));
    }
    z = clamp(z, 0, Math.max(0, params.height - h));
    grid.fillCuboid(x, y, z, w, d, h, true);
  }

  for (let i = 0; i < Math.max(1, params.towerCount); i += 1) {
    const w = randomInt(rng, 1, Math.max(2, Math.floor(params.width * 0.2)));
    const d = randomInt(rng, 1, Math.max(2, Math.floor(params.depth * 0.2)));
    const h = randomInt(rng, Math.max(3, Math.floor(params.height * 0.45)), params.height);
    const x = randomInt(rng, 0, Math.max(0, params.width - w));
    const y = randomInt(rng, 0, Math.max(0, params.depth - d));
    const z = clamp(sampleFootprintHeight(grid, x, y, w, d), 0, Math.max(0, params.height - h));
    grid.fillCuboid(x, y, z, w, d, h, true);
  }
}

function addStructuralPass(grid, params, rng) {
  const ribs = Math.max(2, params.bridgeCount + Math.floor(params.massCount * 0.5));

  for (let i = 0; i < ribs; i += 1) {
    const alongX = rng() < 0.5;
    const thickness = randomInt(rng, 1, 2);
    const h = randomInt(rng, 1, 2);
    const z = randomInt(rng, Math.max(1, Math.floor(params.height * 0.2)), Math.max(1, params.height - h));

    if (alongX) {
      const w = randomInt(rng, Math.max(2, Math.floor(params.width * 0.2)), Math.max(3, Math.floor(params.width * 0.9)));
      const x = randomInt(rng, 0, Math.max(0, params.width - w));
      const y = randomInt(rng, 0, Math.max(0, params.depth - thickness));
      grid.fillCuboid(x, y, z, w, thickness, h, true);
    } else {
      const d = randomInt(rng, Math.max(2, Math.floor(params.depth * 0.2)), Math.max(3, Math.floor(params.depth * 0.9)));
      const x = randomInt(rng, 0, Math.max(0, params.width - thickness));
      const y = randomInt(rng, 0, Math.max(0, params.depth - d));
      grid.fillCuboid(x, y, z, thickness, d, h, true);
    }
  }

  const buttressCount = Math.max(2, Math.floor(params.massCount * 1.5));
  for (let i = 0; i < buttressCount; i += 1) {
    const x = rng() < 0.5 ? 0 : Math.max(0, params.width - 2);
    const y = rng() < 0.5 ? 0 : Math.max(0, params.depth - 2);
    const w = randomInt(rng, 1, 2);
    const d = randomInt(rng, 1, 2);
    const h = randomInt(rng, Math.max(2, Math.floor(params.height * 0.2)), Math.max(3, Math.floor(params.height * 0.65)));
    grid.fillCuboid(x, y, 0, w, d, h, true);
  }

  const terraceCount = Math.max(2, Math.floor(params.massCount + params.towerCount));
  for (let i = 0; i < terraceCount; i += 1) {
    if (rng() > params.terraceRate) {
      continue;
    }
    const w = randomInt(rng, 2, Math.max(3, Math.floor(params.width * 0.5)));
    const d = randomInt(rng, 2, Math.max(3, Math.floor(params.depth * 0.5)));
    const x = randomInt(rng, 0, Math.max(0, params.width - w));
    const y = randomInt(rng, 0, Math.max(0, params.depth - d));
    const z = clamp(sampleFootprintHeight(grid, x, y, w, d), 1, Math.max(1, params.height - 2));
    grid.fillCuboid(x, y, z, w, d, randomInt(rng, 1, 2), true);
  }
}

function runErosionPass(grid, params, rng) {
  const surface = getSurfaceVoxels(grid);
  if (!surface.length) {
    return;
  }

  const seedCount = Math.max(2, Math.floor(surface.length * 0.05 * params.erosionRate));
  const maxSteps = Math.max(4, Math.floor(params.erosionClusterSize * (0.5 + params.erosionRate)));

  for (let i = 0; i < seedCount; i += 1) {
    let best = surface[randomInt(rng, 0, surface.length - 1)];
    for (let attempts = 0; attempts < 5; attempts += 1) {
      const candidate = surface[randomInt(rng, 0, surface.length - 1)];
      const candidateScore = candidate.exposure + candidate.edgeBias + (candidate.underside ? 1.5 : 0);
      const bestScore = best.exposure + best.edgeBias + (best.underside ? 1.5 : 0);
      if (candidateScore > bestScore || rng() < 0.35) {
        best = candidate;
      }
    }

    const frontier = [[best.x, best.y, best.z]];
    const seen = new Set([`${best.x},${best.y},${best.z}`]);

    for (let step = 0; step < maxSteps && frontier.length; step += 1) {
      const index = randomInt(rng, 0, frontier.length - 1);
      const [x, y, z] = frontier[index];
      frontier.splice(index, 1);

      if (!grid.get(x, y, z)) {
        continue;
      }

      if (z <= 0 && rng() < 0.7) {
        continue;
      }

      if (occupiedNeighbors(grid, x, y, z) >= 6) {
        continue;
      }

      if (!wouldDisconnect(grid, x, y, z)) {
        grid.set(x, y, z, false);
      }

      for (const [dx, dy, dz] of NEIGHBORS_6) {
        const gravityBias = dz === -1 ? 0.68 : 0.42;
        if (rng() > gravityBias) {
          continue;
        }

        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        const key = `${nx},${ny},${nz}`;

        if (!grid.inBounds(nx, ny, nz) || seen.has(key) || !grid.get(nx, ny, nz)) {
          continue;
        }

        seen.add(key);
        frontier.push([nx, ny, nz]);
      }
    }
  }

  const collapseChannels = Math.max(1, Math.floor(params.erosionRate * 5));
  for (let i = 0; i < collapseChannels; i += 1) {
    let x = randomInt(rng, 1, Math.max(1, params.width - 2));
    let y = randomInt(rng, 1, Math.max(1, params.depth - 2));
    let z = randomInt(rng, Math.max(1, Math.floor(params.height * 0.35)), Math.max(1, params.height - 1));
    const length = randomInt(rng, 3, Math.max(4, Math.floor(params.height * 0.7)));

    for (let step = 0; step < length; step += 1) {
      if (grid.get(x, y, z) && !wouldDisconnect(grid, x, y, z)) {
        grid.set(x, y, z, false);
      }
      z = Math.max(1, z - 1);
      if (rng() < 0.4) {
        x = clamp(x + (rng() < 0.5 ? -1 : 1), 1, Math.max(1, params.width - 2));
      }
      if (rng() < 0.4) {
        y = clamp(y + (rng() < 0.5 ? -1 : 1), 1, Math.max(1, params.depth - 2));
      }
    }
  }
}

function carveFaceInset(grid, side, x, y, z, w, d, h, inset) {
  if (side === "px") {
    grid.fillCuboid(x + w - inset, y, z, inset, d, h, false);
  } else if (side === "nx") {
    grid.fillCuboid(x, y, z, inset, d, h, false);
  } else if (side === "py") {
    grid.fillCuboid(x, y + d - inset, z, w, inset, h, false);
  } else if (side === "ny") {
    grid.fillCuboid(x, y, z, w, inset, h, false);
  } else if (side === "pz") {
    grid.fillCuboid(x, y, z + h - inset, w, d, inset, false);
  }
}

function addIndustrialDetailPass(grid, params, rng) {
  const detailCount = Math.max(6, Math.floor((params.width + params.depth) * params.greebleDensity));

  for (let i = 0; i < detailCount; i += 1) {
    const x = randomInt(rng, 0, Math.max(0, params.width - 2));
    const y = randomInt(rng, 0, Math.max(0, params.depth - 2));
    const z = randomInt(rng, 1, Math.max(1, params.height - 2));

    const panelW = randomInt(rng, 2, Math.max(2, Math.floor(params.width * 0.35)));
    const panelD = randomInt(rng, 2, Math.max(2, Math.floor(params.depth * 0.35)));
    const panelH = randomInt(rng, 1, Math.max(1, Math.floor(params.height * 0.18)));

    if (rng() < params.panelizationRate) {
      const side = ["px", "nx", "py", "ny", "pz"][randomInt(rng, 0, 4)];
      carveFaceInset(grid, side, x, y, z, panelW, panelD, panelH, 1);
    }

    if (rng() < params.ventRate) {
      const slots = randomInt(rng, 2, 5);
      for (let slot = 0; slot < slots; slot += 1) {
        const sx = clamp(x + slot, 0, params.width - 1);
        grid.fillCuboid(sx, y, z, 1, Math.max(1, Math.floor(panelD * 0.5)), 1, false);
      }
    }

    if (rng() < params.conduitRate) {
      const runLen = randomInt(rng, 2, Math.max(3, Math.floor(params.width * 0.4)));
      if (rng() < 0.5) {
        grid.fillCuboid(x, y, z, runLen, 1, 1, true);
      } else {
        grid.fillCuboid(x, y, z, 1, runLen, 1, true);
      }
      grid.fillCuboid(clamp(x + 1, 0, params.width - 1), clamp(y + 1, 0, params.depth - 1), z, 1, 1, randomInt(rng, 1, 2), true);
    }
  }
}

function addArtifactPass(grid, params, rng) {
  const plateCount = Math.max(2, Math.floor(params.massCount * 0.8));
  for (let i = 0; i < plateCount; i += 1) {
    const w = randomInt(rng, 2, Math.max(3, Math.floor(params.width * 0.3)));
    const d = randomInt(rng, 2, Math.max(3, Math.floor(params.depth * 0.3)));
    const x = randomInt(rng, 0, Math.max(0, params.width - w));
    const y = randomInt(rng, 0, Math.max(0, params.depth - d));
    const z = randomInt(rng, 1, Math.max(1, params.height - 2));

    grid.fillCuboid(x, y, z, w, d, 1, false);
    grid.fillCuboid(x, y, z, w, 1, 1, true);
    grid.fillCuboid(x, y + d - 1, z, w, 1, 1, true);
    grid.fillCuboid(x, y, z, 1, d, 1, true);
    grid.fillCuboid(x + w - 1, y, z, 1, d, 1, true);

    if (rng() < 0.5) {
      const bayH = randomInt(rng, 1, 3);
      grid.fillCuboid(x + 1, y + 1, z, Math.max(1, w - 2), Math.max(1, d - 2), bayH, false);
    }
  }

  const interlockCount = Math.max(2, Math.floor(params.bridgeCount + params.spliceCount));
  for (let i = 0; i < interlockCount; i += 1) {
    const axisX = rng() < 0.5;
    const teeth = randomInt(rng, 3, 7);
    const startX = randomInt(rng, 0, Math.max(0, params.width - 2));
    const startY = randomInt(rng, 0, Math.max(0, params.depth - 2));
    const z = randomInt(rng, 1, Math.max(1, params.height - 2));

    for (let t = 0; t < teeth; t += 1) {
      const x = axisX ? clamp(startX + t, 0, params.width - 1) : startX;
      const y = axisX ? startY : clamp(startY + t, 0, params.depth - 1);
      grid.fillCuboid(x, y, z, 1, 1, randomInt(rng, 1, 2), true);
    }
  }
}

function fillPinholes(grid) {
  for (let z = 1; z < grid.height - 1; z += 1) {
    for (let y = 1; y < grid.depth - 1; y += 1) {
      for (let x = 1; x < grid.width - 1; x += 1) {
        if (grid.get(x, y, z)) {
          continue;
        }
        if (occupiedNeighbors(grid, x, y, z) >= 5) {
          grid.set(x, y, z, true);
        }
      }
    }
  }
}

function simplifySurfaceNoise(grid) {
  const toRemove = [];
  grid.forEachOccupied((x, y, z) => {
    if (z === 0) {
      return;
    }
    if (occupiedNeighbors(grid, x, y, z) <= 1) {
      toRemove.push([x, y, z]);
    }
  });

  for (const [x, y, z] of toRemove) {
    if (!wouldDisconnect(grid, x, y, z)) {
      grid.set(x, y, z, false);
    }
  }
}

function addFallbackMass(grid, params) {
  const cx = Math.floor(params.width * 0.25);
  const cy = Math.floor(params.depth * 0.25);

  grid.fillCuboid(cx, cy, 0, Math.max(2, Math.floor(params.width * 0.5)), Math.max(2, Math.floor(params.depth * 0.5)), Math.max(3, Math.floor(params.height * 0.75)), true);
  grid.fillCuboid(
    clamp(cx + Math.floor(params.width * 0.2), 0, params.width - 2),
    clamp(cy + Math.floor(params.depth * 0.1), 0, params.depth - 2),
    Math.max(1, Math.floor(params.height * 0.45)),
    Math.max(2, Math.floor(params.width * 0.35)),
    Math.max(2, Math.floor(params.depth * 0.35)),
    Math.max(2, Math.floor(params.height * 0.25)),
    true
  );
}

function validateGrid(grid) {
  return {
    occupied: grid.countOccupied(),
    connected: isConnected(grid),
    watertightEquivalent: grid.countOccupied() > 0
  };
}

function runIntegrityPass(grid, params, rng) {
  fillPinholes(grid);
  simplifySurfaceNoise(grid);
  connectComponents(grid, rng);

  if (grid.countOccupied() < 20) {
    addFallbackMass(grid, params);
  }

  connectComponents(grid, rng);
}

export function generateThemedForm(rawParams) {
  const params = withThemeDefaults(rawParams);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const rng = createRng(params.seed + attempt * 7919);
    const grid = new VoxelGrid(params.width, params.depth, params.height);

    addBaseMassing(grid, params, rng);
    addStructuralPass(grid, params, rng);
    runErosionPass(grid, params, rng);
    addIndustrialDetailPass(grid, params, rng);
    addArtifactPass(grid, params, rng);
    runIntegrityPass(grid, params, rng);

    const validation = validateGrid(grid);
    if (validation.connected && validation.watertightEquivalent) {
      if (params.debugGeometry) {
        // eslint-disable-next-line no-console
        console.debug("geometry validation", validation);
      }
      return grid;
    }
  }

  const fallback = new VoxelGrid(params.width, params.depth, params.height);
  addFallbackMass(fallback, params);
  return fallback;
}

export function validateGeneratedForm(grid) {
  return validateGrid(grid);
}
