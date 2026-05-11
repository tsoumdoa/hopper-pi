#listParams Grasshopper AI Agent Test Prompts — 25 Object Grid

> **Layout spec:** 25 definitions arranged in a 5×5 grid, each cell spaced **500 units** apart in both the Grasshopper canvas and Rhino viewport (X = column × 500, Y = row × 500).

first focus on genearting 5x5 grid - you might want to build evertyhing at
origin and then move it around

---

## R001–R005 Fundamental Modeling
*Extrusion, Revolution, Pipe, Loft*

| # | Prompt |
|---|--------|
| R001 | Create a box extruded from a 100×100mm rectangle to a height of 150mm, centered at the origin. |
| R002 | Revolve a 2D polyline profile (L-shaped cross-section) 360° around the Y-axis to create a turned solid. |
| R003 | Create a pipe with 10mm radius along a 3D sine curve spanning 300mm in X. |
| R004 | Loft through 5 horizontally stacked ellipses that progressively rotate 18° and scale down by 10% each. |
| R005 | Generate a helical coil: pipe of radius 5mm along a helix with radius 40mm, pitch 30mm, and 6 turns. |

---

## R006–R010 Parametric Patterns
*Voronoi, Fractals, L-systems*

| # | Prompt |
|---|--------|
| R006 | Generate a 2D Voronoi diagram from 25 random seed points within a 200×200mm boundary and extrude each cell by a random height between 10–80mm. |
| R007 | Build a 3D fractal tree: recursive branching (angle 25°, scale 0.7) to 6 levels using pipes. |
| R008 | Create a phyllotaxis spiral of 150 circles (r=8mm each) following the golden angle (137.5°). |
| R009 | Create a Penrose tiling pattern (P3 rhombus type) within a 250×250mm boundary. |
| R010 | Build a parametric Islamic geometric star pattern (8-point) tiled 4×4 and extruded 20mm. |

---

## R011–R015 Architectural Elements
*Stairs, Roofs, Facades, Louvers*

| # | Prompt |
|---|--------|
| R011 | Generate a straight-run staircase: 18 treads (280mm depth, 175mm rise, 1200mm width). |
| R012 | Build a spiral staircase: 24 steps winding 360° around a central column (Ø150mm) at 3600mm total rise. |
| R013 | Generate a parametric louver facade: 60 horizontal aluminum fins (width 200mm, depth 80mm) with angle driven by floor level. |
| R014 | Generate a parametric dome: geodesic frequency-3 triangulation over a hemisphere (radius 10m). |
| R015 | Generate a perforated facade panel: 2400×3600mm plate with gradient circle perforations (Ø20–80mm). |

---

## R016–R020 Advanced Surface and Mesh Processing

| # | Prompt |
|---|--------|
| R016 | Build a NURBS surface from a 6×6 control point grid with manually assigned Z-heights forming a saddle. |
| R017 | Generate an isosurface (marching cubes) from a scalar field defined by distance to 5 attractor points. |
| R018 | Build a parametric crease pattern and simulate its Miura-ori fold (4×6 unit cells). |
| R019 | Build a surface panelization: divide a freeform NURBS surface into planar quad panels with tolerance 2mm. |
| R020 | Generate a Voronoi mesh on a freeform surface and thicken each cell wall to 3mm. |

---

## R021–R025 Complex 3D Forms
*TPMS, Lattices, Crystal Structures*

| # | Prompt |
|---|--------|
| R021 | Generate a Gyroid TPMS (triply periodic minimal surface) with 2×2×2 unit cells in a 150mm cube, thickened to 2mm walls. |
| R022 | Generate a body-centered cubic (BCC) lattice infill within a 150mm cube (6×6×6 unit cells, strut Ø3mm). |
| R023 | Build a Kelvin foam lattice (tetrakaidecahedron cells, 4×4×4 array) with 2mm strut diameter. |
| R024 | Build a tensegrity structure: 6 compression struts (Ø8mm) and 24 tension cables (Ø2mm) in an icosahedral configuration. |
| R025 | Create a composite form combining a Gyroid TPMS infill, a geodesic outer shell (frequency 4), and a diagrid structural cage — all within a 200mm sphere. |

---

## Grid Layout Reference

```text
     col0   col1   col2   col3   col4
row0  R001   R002   R003   R004   R005
row1  R006   R007   R008   R009   R010
row2  R011   R012   R013   R014   R015
row3  R016   R017   R018   R019   R020
row4  R021   R022   R023   R024   R025
```

**Rhino world position formula:**
- `X = column_index × 500`
- `Y = row_index × 500`
- `Z = 0` (base plane per object)
