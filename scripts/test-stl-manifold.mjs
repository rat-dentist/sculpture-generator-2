import { generateForm } from "../ui/engine/form-engine.js";
import { buildExportStlFromGrid, validateTriangleMesh } from "../ui/engine/mesh-export.js";

const DEFAULT_FORM = {
  width: 10,
  depth: 10,
  height: 12,
  massCount: 4,
  carveCount: 5,
  bridgeCount: 3,
  towerCount: 3,
  terraceRate: 0.35,
  cantileverRate: 0.3,
  notchCount: 6,
  spliceCount: 4,
  verticalBias: 0.62,
  supportRatio: 0.2
};

function parseTrianglesFromAsciiStl(stlText) {
  const triangles = [];
  const lines = stlText.split(/\r?\n/);
  let vertices = [];
  let normal = { x: 0, y: 0, z: 1 };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("facet normal ")) {
      const parts = trimmed.split(/\s+/);
      normal = {
        x: Number(parts[2] || 0),
        y: Number(parts[3] || 0),
        z: Number(parts[4] || 0)
      };
      vertices = [];
      continue;
    }
    if (trimmed.startsWith("vertex ")) {
      const parts = trimmed.split(/\s+/);
      vertices.push({
        x: Number(parts[1] || 0),
        y: Number(parts[2] || 0),
        z: Number(parts[3] || 0)
      });
      continue;
    }
    if (trimmed === "endfacet" && vertices.length === 3) {
      triangles.push({
        normal,
        vertices: [vertices[0], vertices[1], vertices[2]]
      });
    }
  }
  return triangles;
}

function parseSeeds(argv) {
  const values = argv.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (values.length > 0) {
    return values;
  }
  return [1042, 1187, 1301, 1477, 1609, 1723];
}

function main() {
  const seeds = parseSeeds(process.argv.slice(2));
  for (const seed of seeds) {
    const grid = generateForm({
      ...DEFAULT_FORM,
      seed
    });

    const { stl, triangleCount, report } = buildExportStlFromGrid(grid, {
      name: `seed-${seed}`,
      voxelSize: 1
    });

    const parsedTriangles = parseTrianglesFromAsciiStl(stl);
    const roundTrip = validateTriangleMesh(parsedTriangles);

    const ok = report.isManifold
      && report.isClosed
      && report.isSingleComponent
      && report.voxelComponents === 1
      && roundTrip.isManifold
      && roundTrip.isClosed
      && roundTrip.isSingleComponent
      && triangleCount > 0;

    console.log(
      [
        `seed=${seed}`,
        `triangles=${triangleCount}`,
        `edges=${report.edgeCount}`,
        `mesh_components=${report.connectedComponents}`,
        `voxel_components=${report.voxelComponents}`,
        `watertight=${report.isClosed}`,
        `manifold=${report.isManifold}`
      ].join(" ")
    );

    if (!ok) {
      throw new Error(`STL manifold regression failed for seed ${seed}`);
    }
  }
}

main();
