import { buildPreviewSvg } from "../ui/engine/svg-export.js";
import { toneIndexForFace } from "../ui/engine/projection.js";
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

  for (const shaderPreset of ["lines", "crosshatch", "contour-bands", "ascii", "ordered-dither", "error-diffusion", "stipple"]) {
    const shader = generateFaceShaderStrokes(face, {
      ...controlsBase,
      shaderPreset
    });
    if ((shader.strokes || []).length <= 0) {
      throw new Error(`${shaderPreset} emitted no shader strokes.`);
    }
  }
}

testSixTonePalette();
testToneIndexMapping();
testShaderStylesEmit();
console.log("shader regression ok");
