# Iso Plot Studio

Desktop app for generating voxel-based isometric forms and plotter-friendly pen shading.

## Features

- Form engine:
  - voxel occupancy grid (`W x D x H`)
  - mass union + carving + bridges
  - stability cleanup for unsupported floating cells
  - merged exposed-face meshing (large planar faces, not tiny per-voxel faces)
- Mark engine:
  - hatch
  - crosshatch
  - stipple
  - concentric contour rings
  - silhouette/internal edge hierarchy
  - optional ground shadow stripes
- Export:
  - SVG grouped by pen layer:
    - `pen_a_outline`
    - `pen_b_midtone`
    - `pen_c_dense`
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

## VS Code one-click launch

- NPM Scripts panel: run `dev` (play icon).
- Or Run and Debug: use `Desktop App (npm dev)` from `.vscode/launch.json`.

## File layout

- `electron/main.js`: desktop shell + save dialog IPC
- `electron/preload.js`: secure bridge for SVG save
- `ui/app.js`: UI orchestration and state
- `ui/engine/form-engine.js`: voxel form generation
- `ui/engine/mesher.js`: exposed face extraction + greedy merge
- `ui/engine/projection.js`: isometric projection + face visibility
- `ui/engine/mark-engine.js`: hatch/crosshatch/stipple/contour stroke generation
- `ui/engine/svg-export.js`: preview SVG + export SVG assembly

