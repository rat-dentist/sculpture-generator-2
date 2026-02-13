import { generateForm } from "../ui/engine/form-engine.js";
import { extractMergedFaces } from "../ui/engine/mesher.js";
import { projectFaces } from "../ui/engine/projection.js";
import { buildStrokeScene } from "../ui/engine/mark-engine.js";
import { buildPreviewSvg } from "../ui/engine/svg-export.js";

function testSixTonePalette() {
  const faces = [];
  for (let i = 0; i < 6; i += 1) {
    faces.push({
      id: i + 1,
      toneIndex: i,
      points: [
        { x: i * 12, y: 0 },
        { x: i * 12 + 10, y: 0 },
        { x: i * 12 + 10, y: 10 },
        { x: i * 12, y: 10 }
      ]
    });
  }

  const scene = {
    faces,
    layers: {
      outline: [],
      internal: [],
      shader: []
    },
    debug: null
  };

  const svg = buildPreviewSvg(
    scene,
    {
      showFaces: true,
      showOutline: false,
      showInternal: false,
      shaderEnabled: false,
      showOcclusionDebug: false,
      showOcclusionText: false,
      showEdgePreMerge: false,
      showEdgePostMerge: false,
      showEndpointClusters: false
    },
    {
      width: 320,
      height: 120,
      zoom: 1,
      panX: 0,
      panY: 0,
      lockCenter: false
    }
  );

  const fills = [...svg.matchAll(/fill=\"(#[0-9a-fA-F]{6})\"/g)].map((match) => match[1].toLowerCase());
  const unique = new Set(fills.filter((value) => value !== "#f8f5ee"));
  if (unique.size < 6) {
    throw new Error(`Expected 6 face greys, got ${unique.size}`);
  }
}

function testAsciiPresetOutput() {
  const grid = generateForm({
    seed: 1042,
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
  });
  const faces = projectFaces(extractMergedFaces(grid), {
    yawDeg: 45,
    pitchDeg: 0,
    orientation: null,
    scale: 30,
    pivot: { x: 0, y: 0, z: 0 }
  });

  const scene = buildStrokeScene(faces, {
    seed: 1042,
    occlusionDebug: false,
    shaderPreset: "ascii-medium",
    maxStrokes: 7000,
    minSegment: 0.8
  });

  if ((scene.stats.shaderStrokes || 0) <= 0) {
    throw new Error("ASCII medium preset emitted no shader strokes.");
  }
}

testSixTonePalette();
testAsciiPresetOutput();
console.log("shader regression ok");
