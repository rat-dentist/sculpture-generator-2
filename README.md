# Iso Plot Studio

Desktop app for generating voxel-based isometric forms and plotter-friendly pen shading.

## Features

- Form engine:
  - voxel occupancy grid (`W x D x H`)
  - deterministic multi-pass theme pipeline (base massing, structural additions, erosion, industrial greebles, artifact cues)
  - connectivity-preserving erosion and integrity repair (component bridging + pinhole filling)
  - validation/re-roll loop to keep forms single-component and watertight at voxel-surface extraction stage
  - merged exposed-face meshing (large planar faces, not tiny per-voxel faces)
- Mark engine:
  - lines
  - crosshatch
  - ASCII glyph shading
  - ordered dither
  - error diffusion
  - stipple
  - per-face shader pipeline:
    - visible faces are tone-quantized into 6 bins (`0` darkest, `5` lightest)
    - patterns are generated deterministically per face and clipped to face polygons
    - default pattern placement is screen-aligned for stable orbit behavior
  - silhouette/internal edge hierarchy
- Export:
  - SVG grouped by pen layer:
    - `pen_a_outline`
    - `pen_shader`
  - STL fused solid:
    - built from voxel boundary surface extraction (not per-box soup)
    - internal touching faces removed before triangulation
    - manifold validation (closed edges, no degenerate/duplicate faces, single component)
- Desktop UX:
  - seed + regenerate
  - rotation (yaw) + scale
  - form parameters
  - face-type shading mapping (`top`, `left`, `right`)
  - live layer toggles

## Run

```bash
npm install
npm run dev
```

## STL Validation Test

```bash
npm run test:stl
```

## Lines Shader Tuning

The `Lines` shader now uses area-aware density controls aimed at pen plotting:

- `spacing_min`: hard lower bound for hatch spacing; resolved as `max(linesMinSpacing, shaderPenWidth * linesMinSpacingPenFactor)`. This prevents stroke overlap/black fills.
- `S_small` / `S_large`: projected-face scale thresholds (`linesSmallFaceScale`, `linesLargeFaceScale`) used by a smoothstep area protection factor. Faces near `S_small` are clamped harder; faces near `S_large` are mostly unmodified.
- tone curve (`linesToneGamma`, `linesToneContrast`, `linesToneMinDarkness`, `linesToneMaxDarkness`): compresses tonal extremes into a mid-range before hatch spacing is computed, so dark/light separation remains readable without near-black or near-white blowouts.
- small-face stroke caps: short-side line limits and coverage caps keep tiny polygons from accumulating too much ink.

These parameters are internal defaults today (no dedicated UI controls yet), but can be passed through render controls for scripted runs.

## VS Code one-click launch

- NPM Scripts panel: run `dev` (play icon).
- Or Run and Debug: use `Desktop App (npm dev)` from `.vscode/launch.json`.

## File layout

- `electron/main.js`: desktop shell + save dialog IPC
- `electron/preload.js`: secure bridge for SVG/STL save
- `ui/app.js`: UI orchestration and state
- `ui/engine/form-engine.js`: form generation entrypoint
- `ui/engine/geometry-themes.js`: themed geometry passes + validation/repair
- `ui/engine/mesher.js`: exposed face extraction + greedy merge
- `ui/engine/mesh-export.js`: fused face triangulation + STL export
- `ui/engine/projection.js`: isometric projection + face visibility
- `ui/engine/mark-engine.js`: outline/internal/shader stroke generation + occlusion
- `ui/engine/svg-export.js`: preview SVG + export SVG assembly

