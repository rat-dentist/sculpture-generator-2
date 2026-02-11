function greedyRectangles(mask, width, height) {
  const used = new Uint8Array(mask.length);
  const rects = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = y * width + x;
      if (!mask[start] || used[start]) {
        continue;
      }

      let rectWidth = 1;
      while (x + rectWidth < width) {
        const index = y * width + x + rectWidth;
        if (!mask[index] || used[index]) {
          break;
        }
        rectWidth += 1;
      }

      let rectHeight = 1;
      let growing = true;
      while (growing && y + rectHeight < height) {
        for (let xx = 0; xx < rectWidth; xx += 1) {
          const index = (y + rectHeight) * width + x + xx;
          if (!mask[index] || used[index]) {
            growing = false;
            break;
          }
        }

        if (growing) {
          rectHeight += 1;
        }
      }

      for (let yy = 0; yy < rectHeight; yy += 1) {
        for (let xx = 0; xx < rectWidth; xx += 1) {
          used[(y + yy) * width + x + xx] = 1;
        }
      }

      rects.push({ x, y, w: rectWidth, h: rectHeight });
    }
  }

  return rects;
}

function makePoint(x, y, z) {
  return { x, y, z };
}

function buildFacesOnAxisX(grid, faces, nextId) {
  for (let x = 0; x < grid.width; x += 1) {
    const maskPlus = new Uint8Array(grid.depth * grid.height);
    const maskMinus = new Uint8Array(grid.depth * grid.height);

    for (let z = 0; z < grid.height; z += 1) {
      for (let y = 0; y < grid.depth; y += 1) {
        const index = z * grid.depth + y;
        const filled = grid.get(x, y, z);
        if (!filled) {
          continue;
        }

        if (!grid.get(x + 1, y, z)) {
          maskPlus[index] = 1;
        }

        if (!grid.get(x - 1, y, z)) {
          maskMinus[index] = 1;
        }
      }
    }

    for (const rect of greedyRectangles(maskPlus, grid.depth, grid.height)) {
      const y0 = rect.x;
      const y1 = rect.x + rect.w;
      const z0 = rect.y;
      const z1 = rect.y + rect.h;

      faces.push({
        id: nextId(),
        normal: { x: 1, y: 0, z: 0 },
        area: rect.w * rect.h,
        corners: [
          makePoint(x + 1, y0, z0),
          makePoint(x + 1, y1, z0),
          makePoint(x + 1, y1, z1),
          makePoint(x + 1, y0, z1)
        ]
      });
    }

    for (const rect of greedyRectangles(maskMinus, grid.depth, grid.height)) {
      const y0 = rect.x;
      const y1 = rect.x + rect.w;
      const z0 = rect.y;
      const z1 = rect.y + rect.h;

      faces.push({
        id: nextId(),
        normal: { x: -1, y: 0, z: 0 },
        area: rect.w * rect.h,
        corners: [
          makePoint(x, y0, z0),
          makePoint(x, y0, z1),
          makePoint(x, y1, z1),
          makePoint(x, y1, z0)
        ]
      });
    }
  }
}

function buildFacesOnAxisY(grid, faces, nextId) {
  for (let y = 0; y < grid.depth; y += 1) {
    const maskPlus = new Uint8Array(grid.width * grid.height);
    const maskMinus = new Uint8Array(grid.width * grid.height);

    for (let z = 0; z < grid.height; z += 1) {
      for (let x = 0; x < grid.width; x += 1) {
        const index = z * grid.width + x;
        const filled = grid.get(x, y, z);
        if (!filled) {
          continue;
        }

        if (!grid.get(x, y + 1, z)) {
          maskPlus[index] = 1;
        }

        if (!grid.get(x, y - 1, z)) {
          maskMinus[index] = 1;
        }
      }
    }

    for (const rect of greedyRectangles(maskPlus, grid.width, grid.height)) {
      const x0 = rect.x;
      const x1 = rect.x + rect.w;
      const z0 = rect.y;
      const z1 = rect.y + rect.h;

      faces.push({
        id: nextId(),
        normal: { x: 0, y: 1, z: 0 },
        area: rect.w * rect.h,
        corners: [
          makePoint(x0, y + 1, z0),
          makePoint(x1, y + 1, z0),
          makePoint(x1, y + 1, z1),
          makePoint(x0, y + 1, z1)
        ]
      });
    }

    for (const rect of greedyRectangles(maskMinus, grid.width, grid.height)) {
      const x0 = rect.x;
      const x1 = rect.x + rect.w;
      const z0 = rect.y;
      const z1 = rect.y + rect.h;

      faces.push({
        id: nextId(),
        normal: { x: 0, y: -1, z: 0 },
        area: rect.w * rect.h,
        corners: [
          makePoint(x0, y, z0),
          makePoint(x0, y, z1),
          makePoint(x1, y, z1),
          makePoint(x1, y, z0)
        ]
      });
    }
  }
}

function buildFacesOnAxisZ(grid, faces, nextId) {
  for (let z = 0; z < grid.height; z += 1) {
    const maskPlus = new Uint8Array(grid.width * grid.depth);
    const maskMinus = new Uint8Array(grid.width * grid.depth);

    for (let y = 0; y < grid.depth; y += 1) {
      for (let x = 0; x < grid.width; x += 1) {
        const index = y * grid.width + x;
        const filled = grid.get(x, y, z);
        if (!filled) {
          continue;
        }

        if (!grid.get(x, y, z + 1)) {
          maskPlus[index] = 1;
        }

        if (!grid.get(x, y, z - 1)) {
          maskMinus[index] = 1;
        }
      }
    }

    for (const rect of greedyRectangles(maskPlus, grid.width, grid.depth)) {
      const x0 = rect.x;
      const x1 = rect.x + rect.w;
      const y0 = rect.y;
      const y1 = rect.y + rect.h;

      faces.push({
        id: nextId(),
        normal: { x: 0, y: 0, z: 1 },
        area: rect.w * rect.h,
        corners: [
          makePoint(x0, y0, z + 1),
          makePoint(x1, y0, z + 1),
          makePoint(x1, y1, z + 1),
          makePoint(x0, y1, z + 1)
        ]
      });
    }

    for (const rect of greedyRectangles(maskMinus, grid.width, grid.depth)) {
      const x0 = rect.x;
      const x1 = rect.x + rect.w;
      const y0 = rect.y;
      const y1 = rect.y + rect.h;

      faces.push({
        id: nextId(),
        normal: { x: 0, y: 0, z: -1 },
        area: rect.w * rect.h,
        corners: [
          makePoint(x0, y0, z),
          makePoint(x0, y1, z),
          makePoint(x1, y1, z),
          makePoint(x1, y0, z)
        ]
      });
    }
  }
}

export function extractMergedFaces(grid) {
  const faces = [];
  let id = 1;
  const nextId = () => {
    const current = id;
    id += 1;
    return current;
  };

  buildFacesOnAxisX(grid, faces, nextId);
  buildFacesOnAxisY(grid, faces, nextId);
  buildFacesOnAxisZ(grid, faces, nextId);

  return faces;
}