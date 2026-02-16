import { buildPreviewSvg } from "../ui/engine/svg-export.js";
import { projectFaces, toneIndexForFace } from "../ui/engine/projection.js";
import { generateFaceShaderStrokes } from "../ui/engine/shader-styles.js";

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

  const fills = [...svg.matchAll(/fill="(#[0-9a-fA-F]{6})"/g)].map((match) => match[1].toLowerCase());
  const unique = new Set(fills.filter((value) => value !== "#f8f5ee"));
  if (unique.size < 6) {
    throw new Error(`Expected 6 face greys, got ${unique.size}`);
  }
}

function testToneIndexMapping() {
  const shadeKeys = ["z_pos", "x_pos", "y_pos", "x_neg", "y_neg", "z_neg"];
  const toneSet = new Set(shadeKeys.map((shadeKey) => toneIndexForFace({ shadeKey })));
  if (toneSet.size !== 6) {
    throw new Error(`Expected 6 unique tone indices, got ${toneSet.size}`);
  }
}

function testShaderStylesEmit() {
  const face = {
    id: 12,
    faceType: "left",
    shadeKey: "z_neg",
    toneIndex: 4,
    points: [
      { x: 0, y: 0 },
      { x: 24, y: 0 },
      { x: 24, y: 24 },
      { x: 0, y: 24 }
    ]
  };

  const controlsBase = {
    seed: 1042,
    occlusionDebug: false,
    maxStrokes: 7000,
    minSegment: 0.8,
    shaderCoarse: false
  };

  for (const shaderPreset of ["lines", "crosshatch", "concentric", "stipple", "ordered-dither", "error-diffusion", "ascii", "brick-weave", "contour-bands", "ascii-legacy", "ascii-solid"]) {
    const shader = generateFaceShaderStrokes(face, {
      ...controlsBase,
      shaderPreset
    });
    if ((shader.strokes || []).length <= 0) {
      throw new Error(`${shaderPreset} emitted no shader strokes.`);
    }
  }
}

function makeCubeFaces(size = 1) {
  const s = size;
  return [
    { id: 1, normal: { x: 1, y: 0, z: 0 }, area: s * s, corners: [{ x: s, y: 0, z: 0 }, { x: s, y: s, z: 0 }, { x: s, y: s, z: s }, { x: s, y: 0, z: s }] },
    { id: 2, normal: { x: -1, y: 0, z: 0 }, area: s * s, corners: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: s }, { x: 0, y: s, z: s }, { x: 0, y: s, z: 0 }] },
    { id: 3, normal: { x: 0, y: 1, z: 0 }, area: s * s, corners: [{ x: 0, y: s, z: 0 }, { x: 0, y: s, z: s }, { x: s, y: s, z: s }, { x: s, y: s, z: 0 }] },
    { id: 4, normal: { x: 0, y: -1, z: 0 }, area: s * s, corners: [{ x: 0, y: 0, z: 0 }, { x: s, y: 0, z: 0 }, { x: s, y: 0, z: s }, { x: 0, y: 0, z: s }] },
    { id: 5, normal: { x: 0, y: 0, z: 1 }, area: s * s, corners: [{ x: 0, y: 0, z: s }, { x: s, y: 0, z: s }, { x: s, y: s, z: s }, { x: 0, y: s, z: s }] },
    { id: 6, normal: { x: 0, y: 0, z: -1 }, area: s * s, corners: [{ x: 0, y: 0, z: 0 }, { x: 0, y: s, z: 0 }, { x: s, y: s, z: 0 }, { x: s, y: 0, z: 0 }] }
  ];
}

function testCubeProjectionAndShaderCoverage() {
  const cubeFaces = makeCubeFaces(1);
  const projection = projectFaces(
    cubeFaces,
    {
      yawDeg: 40,
      pitchDeg: 0,
      scale: 48,
      pivot: { x: 0.5, y: 0.5, z: 0.5 }
    },
    { coarseVisibility: false }
  );

  if ((projection.faces || []).length < 2) {
    throw new Error(`Expected at least 2 visible cube faces, got ${(projection.faces || []).length}`);
  }

  const toneCount = new Set((projection.faces || []).map((face) => face.toneIndex)).size;
  if (toneCount < 2) {
    throw new Error(`Expected at least 2 distinct tone indices on cube, got ${toneCount}`);
  }

  let shaded = 0;
  for (const face of projection.faces || []) {
    if (face.faceType === "top") {
      continue;
    }
    const shader = generateFaceShaderStrokes(face, {
      seed: 1337,
      shaderPreset: "lines",
      maxStrokes: 5000,
      minSegment: 0.8,
      shaderCoarse: false,
      faceStrokeBudget: 320
    });
    if ((shader.strokes || []).length > 0) {
      shaded += 1;
    }
  }

  if (shaded < 2) {
    throw new Error(`Expected at least 2 shaded side faces on cube, got ${shaded}`);
  }
}

testSixTonePalette();
testToneIndexMapping();
testShaderStylesEmit();
testCubeProjectionAndShaderCoverage();
console.log("shader regression ok");
