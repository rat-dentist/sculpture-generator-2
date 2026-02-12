import { VoxelGrid } from "./grid.js";
import { createRng, randomFloat, randomInt } from "./random.js";

const NEIGHBORS_4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
];

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

function sampleFootprintHeight(grid, x, y, w, d) {
  let top = -1;

  for (let yy = y; yy < y + d; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) {
      top = Math.max(top, grid.highestAt(xx, yy));
    }
  }

  return top + 1;
}

function addMasses(grid, params, rng) {
  const minW = Math.max(2, Math.floor(params.width * 0.2));
  const maxW = Math.max(minW + 1, Math.floor(params.width * 0.7));
  const minD = Math.max(2, Math.floor(params.depth * 0.2));
  const maxD = Math.max(minD + 1, Math.floor(params.depth * 0.7));
  const minH = Math.max(2, Math.floor(params.height * 0.25));
  const maxH = Math.max(minH + 1, Math.floor(params.height * 0.9));

  for (let i = 0; i < params.massCount; i += 1) {
    const w = clamp(randomInt(rng, minW, maxW), 1, params.width);
    const d = clamp(randomInt(rng, minD, maxD), 1, params.depth);
    const h = clamp(randomInt(rng, minH, maxH), 1, params.height);

    const x = randomInt(rng, 0, Math.max(0, params.width - w));
    const y = randomInt(rng, 0, Math.max(0, params.depth - d));

    let z = 0;
    if (i > 0 && rng() < 0.76) {
      z = sampleFootprintHeight(grid, x, y, w, d);
      if (rng() < 0.3) {
        z -= randomInt(rng, 0, 2);
      }
    }

    z = clamp(z, 0, Math.max(0, params.height - h));
    grid.fillCuboid(x, y, z, w, d, h, true);
  }
}

function addBridges(grid, params, rng) {
  for (let i = 0; i < params.bridgeCount; i += 1) {
    const alongX = rng() < 0.5;
    const thickness = randomInt(rng, 1, 2);
    const bridgeHeight = randomInt(rng, Math.max(1, Math.floor(params.height * 0.3)), Math.max(2, params.height - 2));

    if (alongX) {
      const w = clamp(
        randomInt(rng, Math.max(3, Math.floor(params.width * 0.35)), Math.max(4, Math.floor(params.width * 0.9))),
        2,
        params.width
      );
      const d = clamp(thickness, 1, params.depth);
      const h = randomInt(rng, 1, 2);
      const x = randomInt(rng, 0, Math.max(0, params.width - w));
      const y = randomInt(rng, 0, Math.max(0, params.depth - d));
      const z = clamp(bridgeHeight, 0, Math.max(0, params.height - h));

      grid.fillCuboid(x, y, z, w, d, h, true);
      continue;
    }

    const w = clamp(thickness, 1, params.width);
    const d = clamp(
      randomInt(rng, Math.max(3, Math.floor(params.depth * 0.35)), Math.max(4, Math.floor(params.depth * 0.9))),
      2,
      params.depth
    );
    const h = randomInt(rng, 1, 2);
    const x = randomInt(rng, 0, Math.max(0, params.width - w));
    const y = randomInt(rng, 0, Math.max(0, params.depth - d));
    const z = clamp(bridgeHeight, 0, Math.max(0, params.height - h));

    grid.fillCuboid(x, y, z, w, d, h, true);
  }
}

function carveVolumes(grid, params, rng) {
  const maxSize = Math.max(2, Math.floor(Math.min(params.width, params.depth, params.height) * 0.6));

  for (let i = 0; i < params.carveCount; i += 1) {
    if (rng() < 0.52) {
      const vertical = rng() < 0.5;

      if (vertical) {
        const w = randomInt(rng, 1, Math.max(1, Math.floor(params.width * 0.2)));
        const d = randomInt(rng, Math.max(2, Math.floor(params.depth * 0.2)), Math.max(3, Math.floor(params.depth * 0.6)));
        const h = randomInt(rng, Math.max(2, Math.floor(params.height * 0.3)), Math.max(3, Math.floor(params.height * 0.95)));
        const x = randomInt(rng, 0, Math.max(0, params.width - w));
        const y = randomInt(rng, 0, Math.max(0, params.depth - d));
        const z = randomInt(rng, 0, Math.max(0, params.height - h));

        grid.fillCuboid(x, y, z, w, d, h, false);
      } else {
        const w = randomInt(rng, Math.max(2, Math.floor(params.width * 0.2)), Math.max(3, Math.floor(params.width * 0.6)));
        const d = randomInt(rng, 1, Math.max(1, Math.floor(params.depth * 0.2)));
        const h = randomInt(rng, Math.max(2, Math.floor(params.height * 0.3)), Math.max(3, Math.floor(params.height * 0.95)));
        const x = randomInt(rng, 0, Math.max(0, params.width - w));
        const y = randomInt(rng, 0, Math.max(0, params.depth - d));
        const z = randomInt(rng, 0, Math.max(0, params.height - h));

        grid.fillCuboid(x, y, z, w, d, h, false);
      }

      continue;
    }

    const w = randomInt(rng, 1, maxSize);
    const d = randomInt(rng, 1, maxSize);
    const h = randomInt(rng, 1, maxSize);
    const x = randomInt(rng, 0, Math.max(0, params.width - w));
    const y = randomInt(rng, 0, Math.max(0, params.depth - d));
    const z = randomInt(rng, 0, Math.max(0, params.height - h));

    grid.fillCuboid(x, y, z, w, d, h, false);
  }
}


function addTowers(grid, params, rng) {
  const minBase = 1;
  const maxBase = Math.max(2, Math.floor(Math.min(params.width, params.depth) * 0.25));

  for (let i = 0; i < params.towerCount; i += 1) {
    const w = randomInt(rng, minBase, maxBase);
    const d = randomInt(rng, minBase, maxBase);
    const h = randomInt(rng, Math.max(3, Math.floor(params.height * 0.45)), Math.max(4, params.height));
    const x = randomInt(rng, 0, Math.max(0, params.width - w));
    const y = randomInt(rng, 0, Math.max(0, params.depth - d));

    let z = sampleFootprintHeight(grid, x, y, w, d);
    if (rng() > params.verticalBias) {
      z = Math.max(0, z - randomInt(rng, 0, 2));
    }

    z = clamp(z, 0, Math.max(0, params.height - h));
    grid.fillCuboid(x, y, z, w, d, h, true);
  }
}

function addTerraces(grid, params, rng) {
  const attempts = Math.max(1, Math.floor(params.massCount + params.towerCount));

  for (let i = 0; i < attempts; i += 1) {
    if (rng() > params.terraceRate) {
      continue;
    }

    const w = randomInt(rng, 2, Math.max(3, Math.floor(params.width * 0.55)));
    const d = randomInt(rng, 2, Math.max(3, Math.floor(params.depth * 0.55)));
    const h = randomInt(rng, 1, 2);
    const x = randomInt(rng, 0, Math.max(0, params.width - w));
    const y = randomInt(rng, 0, Math.max(0, params.depth - d));
    const z = clamp(sampleFootprintHeight(grid, x, y, w, d), 1, Math.max(1, params.height - h));

    grid.fillCuboid(x, y, z, w, d, h, true);
  }
}

function addCantilevers(grid, params, rng) {
  const attempts = Math.max(1, Math.floor(params.bridgeCount + params.spliceCount));

  for (let i = 0; i < attempts; i += 1) {
    if (rng() > params.cantileverRate) {
      continue;
    }

    const alongX = rng() < 0.5;
    const span = alongX
      ? randomInt(rng, Math.max(2, Math.floor(params.width * 0.25)), Math.max(3, Math.floor(params.width * 0.8)))
      : randomInt(rng, Math.max(2, Math.floor(params.depth * 0.25)), Math.max(3, Math.floor(params.depth * 0.8)));
    const thickness = randomInt(rng, 1, 2);
    const h = randomInt(rng, 1, 2);
    const z = randomInt(rng, Math.max(1, Math.floor(params.height * 0.3)), Math.max(2, params.height - h));

    if (alongX) {
      const w = span;
      const d = thickness;
      const x = randomInt(rng, 0, Math.max(0, params.width - w));
      const y = randomInt(rng, 0, Math.max(0, params.depth - d));
      grid.fillCuboid(x, y, z, w, d, h, true);
      continue;
    }

    const w = thickness;
    const d = span;
    const x = randomInt(rng, 0, Math.max(0, params.width - w));
    const y = randomInt(rng, 0, Math.max(0, params.depth - d));
    grid.fillCuboid(x, y, z, w, d, h, true);
  }
}

function carveNotches(grid, params, rng) {
  for (let i = 0; i < params.notchCount; i += 1) {
    const side = randomInt(rng, 0, 3);
    const w = randomInt(rng, 1, Math.max(2, Math.floor(params.width * 0.25)));
    const d = randomInt(rng, 1, Math.max(2, Math.floor(params.depth * 0.25)));
    const h = randomInt(rng, 2, Math.max(3, Math.floor(params.height * 0.75)));
    const z = randomInt(rng, 0, Math.max(0, params.height - h));

    if (side === 0) {
      grid.fillCuboid(0, randomInt(rng, 0, Math.max(0, params.depth - d)), z, w, d, h, false);
      continue;
    }

    if (side === 1) {
      grid.fillCuboid(Math.max(0, params.width - w), randomInt(rng, 0, Math.max(0, params.depth - d)), z, w, d, h, false);
      continue;
    }

    if (side === 2) {
      grid.fillCuboid(randomInt(rng, 0, Math.max(0, params.width - w)), 0, z, w, d, h, false);
      continue;
    }

    grid.fillCuboid(randomInt(rng, 0, Math.max(0, params.width - w)), Math.max(0, params.depth - d), z, w, d, h, false);
  }
}

function addSplices(grid, params, rng) {
  for (let i = 0; i < params.spliceCount; i += 1) {
    const w = randomInt(rng, 1, Math.max(2, Math.floor(params.width * 0.35)));
    const d = randomInt(rng, 1, Math.max(2, Math.floor(params.depth * 0.35)));
    const h = randomInt(rng, 1, 3);
    const x = randomInt(rng, 0, Math.max(0, params.width - w));
    const y = randomInt(rng, 0, Math.max(0, params.depth - d));
    const z = randomInt(rng, 1, Math.max(1, params.height - h));

    if (rng() < 0.5) {
      grid.fillCuboid(x, y, z, w, d, h, true);
    } else {
      grid.fillCuboid(x, y, z, w, d, h, false);
    }
  }
}

function supportRatio(grid, x, y, z) {
  const checks = [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ];
  let supported = 0;

  for (const [dx, dy] of checks) {
    if (grid.get(x + dx, y + dy, z - 1)) {
      supported += 1;
    }
  }

  return supported / checks.length;
}

function hasAnchoredNeighbor(grid, x, y, z) {
  for (const [dx, dy] of NEIGHBORS_4) {
    const nx = x + dx;
    const ny = y + dy;
    if (grid.get(nx, ny, z) && grid.get(nx, ny, z - 1)) {
      return true;
    }
  }
  return false;
}

function pruneUnsupported(grid, threshold, passes, rng) {
  for (let pass = 0; pass < passes; pass += 1) {
    const toRemove = [];

    for (let z = 1; z < grid.height; z += 1) {
      for (let y = 0; y < grid.depth; y += 1) {
        for (let x = 0; x < grid.width; x += 1) {
          if (!grid.get(x, y, z)) {
            continue;
          }

          if (grid.get(x, y, z - 1)) {
            continue;
          }

          const ratio = supportRatio(grid, x, y, z);
          if (ratio >= threshold || hasAnchoredNeighbor(grid, x, y, z)) {
            continue;
          }

          if (rng() < 0.93) {
            toRemove.push([x, y, z]);
          }
        }
      }
    }

    if (!toRemove.length) {
      break;
    }

    for (const [x, y, z] of toRemove) {
      grid.set(x, y, z, false);
    }
  }
}

function pruneFloatingComponents(grid) {
  const visited = new Uint8Array(grid.data.length);
  const queue = [];

  for (let y = 0; y < grid.depth; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      if (!grid.get(x, y, 0)) {
        continue;
      }

      const index = grid.index(x, y, 0);
      if (visited[index]) {
        continue;
      }

      visited[index] = 1;
      queue.push([x, y, 0]);
    }
  }

  for (let i = 0; i < queue.length; i += 1) {
    const [x, y, z] = queue[i];

    for (const [dx, dy, dz] of NEIGHBORS_6) {
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

  grid.forEachOccupied((x, y, z) => {
    if (!visited[grid.index(x, y, z)]) {
      grid.set(x, y, z, false);
    }
  });
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

export function generateForm(params) {
  const rng = createRng(params.seed);
  const grid = new VoxelGrid(params.width, params.depth, params.height);

  const plinthW = Math.max(2, Math.floor(params.width * randomFloat(rng, 0.3, 0.5)));
  const plinthD = Math.max(2, Math.floor(params.depth * randomFloat(rng, 0.3, 0.5)));
  const plinthX = randomInt(rng, 0, Math.max(0, params.width - plinthW));
  const plinthY = randomInt(rng, 0, Math.max(0, params.depth - plinthD));
  grid.fillCuboid(plinthX, plinthY, 0, plinthW, plinthD, 1, true);

  addMasses(grid, params, rng);
  addTowers(grid, params, rng);
  addBridges(grid, params, rng);
  addCantilevers(grid, params, rng);
  addTerraces(grid, params, rng);
  carveVolumes(grid, params, rng);
  carveNotches(grid, params, rng);
  addSplices(grid, params, rng);
  pruneUnsupported(grid, clamp(params.supportRatio, 0, 1), 4, rng);
  pruneFloatingComponents(grid);

  if (grid.countOccupied() < 20) {
    addFallbackMass(grid, params);
  }

  return grid;
}