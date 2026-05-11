# Grasshopper AI Agent Test Prompts — 100 Object Grid

> **Layout spec:** 100 definitions arranged in a 10×10 grid, each cell spaced **500 units** apart in both the Grasshopper canvas and Rhino viewport (X = column × 500, Y = row × 500).

first focus on genearting 10x10 grid - you might want to build evertyhing at
origin and then move it around

---

## L001–L020 Fundamental Modeling

_Extrusion, Revolution, Pipe, Loft, etc._

| #    | Prompt                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------ |
| L001 | Create a box extruded from a 100×100mm rectangle to a height of 150mm, centered at the origin.                     |
| L002 | Extrude a regular hexagon (radius 60mm) vertically by 200mm.                                                       |
| L003 | Revolve a 2D polyline profile (L-shaped cross-section) 360° around the Y-axis to create a turned solid.            |
| L004 | Create a pipe with 10mm radius along a 3D sine curve spanning 300mm in X.                                          |
| L005 | Loft through 5 horizontally stacked ellipses that progressively rotate 18° and scale down by 10% each.             |
| L006 | Create a tapered extrusion (draft angle 10°) from a square base 100×100mm to a height of 200mm.                    |
| L007 | Build a torus with major radius 80mm and minor radius 20mm.                                                        |
| L008 | Create a cone by revolving a right-triangle profile 360° around its vertical leg (height 150mm, base radius 60mm). |
| L009 | Loft between a square (base) and a circle (top) 200mm above to create a transitional solid.                        |
| L010 | Generate a helical coil: pipe of radius 5mm along a helix with radius 40mm, pitch 30mm, and 6 turns.               |
| L011 | Create a planar surface from an irregular closed polyline with 7 control points.                                   |
| L012 | Offset a closed curve by 20mm and loft between the original and offset to create a wall surface.                   |
| L013 | Build a truncated pyramid by lofting a 120×120mm square base and an 80×80mm square 180mm above.                    |
| L014 | Create a swept surface: sweep a semicircular profile along a sinusoidal rail curve.                                |
| L015 | Generate a sphere of radius 75mm and apply a uniform polar subdivision into quads.                                 |
| L016 | Create a 2-rail sweep: a rectangular profile swept along two diverging arc rails.                                  |
| L017 | Build a solid of revolution from a spline profile with 6 control points rotated 270° around Z.                     |
| L018 | Extrude a star-shaped polygon (5 points, outer radius 80mm, inner radius 40mm) by 120mm.                           |
| L019 | Create a variable-radius pipe along a 3D polyline where radius interpolates from 5mm to 20mm.                      |
| L020 | Loft a series of 8 cross-sections that morph from a triangle to a circle over 400mm in Z.                          |

---

## L021–L040 Parametric Patterns

_Voronoi, Fractals, L-systems_

| #    | Prompt                                                                                                                                         |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| L021 | Generate a 2D Voronoi diagram from 25 random seed points within a 200×200mm boundary and extrude each cell by a random height between 10–80mm. |
| L022 | Create a Voronoi pattern on a sphere surface (radius 80mm) with 30 seed points.                                                                |
| L023 | Build a weighted Voronoi where cell size is driven by proximity to a central attractor point.                                                  |
| L024 | Generate a 3-iteration Sierpinski triangle as an extruded flat geometry (base 200mm).                                                          |
| L025 | Create a 4-iteration Koch snowflake curve and extrude it to 30mm height.                                                                       |
| L026 | Build a 3D fractal tree: recursive branching (angle 25°, scale 0.7) to 6 levels using pipes.                                                   |
| L027 | Generate a Cantor set pattern as a grid of extruded boxes across 3 iterations.                                                                 |
| L028 | Create an L-system dragon curve (10 iterations) extruded as a flat ribbon 5mm wide.                                                            |
| L029 | Build a space-filling Hilbert curve (3D, 3rd order) as a pipe of radius 3mm.                                                                   |
| L030 | Generate a Pythagoras tree (6 levels, angle 35°) as planar surfaces.                                                                           |
| L031 | Create a phyllotaxis spiral of 150 circles (r=8mm each) following the golden angle (137.5°).                                                   |
| L032 | Build a hexagonal grid (10×10 cells, cell radius 15mm) where cell height is driven by a sine wave across X.                                    |
| L033 | Generate a Truchet tile pattern on an 8×8 grid with randomized quarter-circle arcs.                                                            |
| L034 | Create a Penrose tiling pattern (P3 rhombus type) within a 250×250mm boundary.                                                                 |
| L035 | Build a reaction-diffusion texture mapped onto a flat surface as raised bump geometry.                                                         |
| L036 | Generate a wave-interference pattern from 3 point sources as a contoured surface.                                                              |
| L037 | Create a Lissajous 3D curve (a=3, b=4, c=5) as a pipe of radius 4mm.                                                                           |
| L038 | Build a parametric Islamic geometric star pattern (8-point) tiled 4×4 and extruded 20mm.                                                       |
| L039 | Generate a spirograph curve (R=100, r=37, d=50) and extrude as a flat solid 10mm thick.                                                        |
| L040 | Create a 2D cellular automaton (Rule 30, 10 generations) mapped to extruded voxel geometry.                                                    |

---

## L041–L060 Architectural Elements

_Stairs, Roofs, Facades, Louvers_

| #    | Prompt                                                                                                                       |
| ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| L041 | Generate a straight-run staircase: 18 treads (280mm depth, 175mm rise, 1200mm width).                                        |
| L042 | Build a spiral staircase: 24 steps winding 360° around a central column (Ø150mm) at 3600mm total rise.                       |
| L043 | Create a cantilevered staircase where each step is extruded from a central spine wall.                                       |
| L044 | Build a parametric hip roof over a rectangular footprint (8m×12m, pitch 30°).                                                |
| L045 | Generate a barrel vault roof (span 10m, radius 6m, length 15m) as a single curved surface.                                   |
| L046 | Create a parametric tensile roof with 4 high points and 4 low points forming a hyperbolic form.                              |
| L047 | Build a diagrid facade panel system on a curved surface: triangulated steel members at 60° angles.                           |
| L048 | Generate a parametric louver facade: 60 horizontal aluminum fins (width 200mm, depth 80mm) with angle driven by floor level. |
| L049 | Create a double-skin glass curtain wall with 600×1200mm unitized panels and integrated shading fins.                         |
| L050 | Build a parametric window wall where opening percentage varies with solar exposure (simulated by orientation angle).         |
| L051 | Generate a space frame roof structure: two-layer square-on-square offset grid (module 1.5m, depth 1.2m).                     |
| L052 | Create a parametric Brise Soleil: vertical concrete fins (depth 400mm) spaced 600mm apart on a south facade.                 |
| L053 | Build a column grid (5×5, spacing 6m) with tapered concrete columns (base Ø600mm, top Ø300mm, height 4m).                    |
| L054 | Generate a parametric dome: geodesic frequency-3 triangulation over a hemisphere (radius 10m).                               |
| L055 | Create a folded plate roof: 8 alternating ridge-valley folds spanning 20m, fold angle 25°.                                   |
| L056 | Build a parametric atrium skylight: NURBS surface with framing members following surface UV lines.                           |
| L057 | Generate a perforated facade panel: 2400×3600mm plate with gradient circle perforations (Ø20–80mm).                          |
| L058 | Create a parametric balcony railing: twisted flat steel balusters at 110mm spacing, 1100mm height.                           |
| L059 | Build a retaining wall with battered face (1:6 batter), drainage holes, and stepped profile every 3m.                        |
| L060 | Generate a parametric acoustic ceiling: 200 suspended baffles at varying heights driven by a wave function.                  |

---

## L061–L080 Advanced Surface and Mesh Processing

| #    | Prompt                                                                                                        |
| ---- | ------------------------------------------------------------------------------------------------------------- |
| L061 | Create a minimal surface approximation of a Schwarz P surface (2×2×2 unit cells, 150mm total).                |
| L062 | Generate a Catmull-Clark subdivision of a low-poly cube mesh (3 iterations).                                  |
| L063 | Build a NURBS surface from a 6×6 control point grid with manually assigned Z-heights forming a saddle.        |
| L064 | Create a mesh relaxation of a flat rectangular mesh pinned at 4 corners under simulated gravity.              |
| L065 | Generate an isosurface (marching cubes) from a scalar field defined by distance to 5 attractor points.        |
| L066 | Build a ruled surface between two non-planar 3D curves and analyze its Gaussian curvature with color mapping. |
| L067 | Create a developable surface unrollable to flat, formed by sweeping a line along two rail curves.             |
| L068 | Generate a mesh with variable quad/triangle remeshing driven by a curvature analysis.                         |
| L069 | Build a woven surface: two sets of 20 ribbons (width 8mm) crossing at 60° angle on a curved base surface.     |
| L070 | Create a smooth blend surface (G2 continuity) between two perpendicular cylindrical surfaces.                 |
| L071 | Generate a point cloud from a scanned terrain DEM and fit a NURBS surface to it.                              |
| L072 | Build a parametric crease pattern and simulate its Miura-ori fold (4×6 unit cells).                           |
| L073 | Create a subdivision surface from a control cage approximating a human hand silhouette.                       |
| L074 | Generate a mesh pipe network following graph edges with variable radius driven by flow capacity values.       |
| L075 | Build a surface panelization: divide a freeform NURBS surface into planar quad panels with tolerance 2mm.     |
| L076 | Create a differential growth simulation on a mesh starting from a flat disc (3 iterations visible).           |
| L077 | Generate a Voronoi mesh on a freeform surface and thicken each cell wall to 3mm.                              |
| L078 | Build a mesh morph: smoothly interpolate between a sphere mesh and a cube mesh in 5 steps.                    |
| L079 | Create a parametric knot surface (trefoil knot profile swept along its own curve, thickened to solid).        |
| L080 | Generate a conformal mapping of a rectangular grid onto a freeform surface maintaining angle fidelity.        |

---

## L081–L100 Complex 3D Forms

_TPMS, Lattices, Crystal Structures_

| #    | Prompt                                                                                                                                                   |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L081 | Generate a Gyroid TPMS (triply periodic minimal surface) with 2×2×2 unit cells in a 150mm cube, thickened to 2mm walls.                                  |
| L082 | Create a Schwarz D surface (Diamond TPMS) with 1.5×1.5×1.5 unit cells and 3mm wall thickness.                                                            |
| L083 | Build a Lidinoid TPMS surface within a 120mm bounding cube (2 unit cells per axis).                                                                      |
| L084 | Generate a body-centered cubic (BCC) lattice infill within a 150mm cube (6×6×6 unit cells, strut Ø3mm).                                                  |
| L085 | Create a face-centered cubic (FCC) lattice structure (5×5×5 cells, strut Ø2.5mm) inside a sphere of radius 80mm.                                         |
| L086 | Build a Kelvin foam lattice (tetrakaidecahedron cells, 4×4×4 array) with 2mm strut diameter.                                                             |
| L087 | Generate a gradient lattice where strut diameter tapers from 6mm (base) to 1.5mm (top) over 150mm height.                                                |
| L088 | Create a Weaire-Phelan foam structure (2×2×2 unit cells) with 2mm wall thickness.                                                                        |
| L089 | Build a diamond cubic crystal structure (carbon): 4×4×4 unit cells, atom spheres Ø8mm, bond pipes Ø3mm.                                                  |
| L090 | Generate a face-centered cubic crystal (gold) with 3×3×3 unit cells, visualized as spheres and bonds.                                                    |
| L091 | Create a hexagonally close-packed (HCP) crystal structure (5 layers, 7 atoms per layer pattern).                                                         |
| L092 | Build a Bravais lattice visualization of all 14 types arranged in a single composition.                                                                  |
| L093 | Generate a parametric octet truss lattice (4×4×4 cells, 150mm total) with Ø4mm struts.                                                                   |
| L094 | Create a Kagome lattice (2D) extruded to 3D with 3mm wire thickness across a 200×200mm area.                                                             |
| L095 | Build a variable-density TPMS (Gyroid) where surface frequency increases toward the center.                                                              |
| L096 | Generate a stochastic Voronoi foam: 80 random seed points in a 150mm cube, walls thickened to 1.5mm.                                                     |
| L097 | Create a parametric crystal growth simulation: 5 nucleation points with dendritic branching to 4 levels.                                                 |
| L098 | Build a tensegrity structure: 6 compression struts (Ø8mm) and 24 tension cables (Ø2mm) in an icosahedral configuration.                                  |
| L099 | Generate a 4D hypercube (tesseract) projected into 3D and extruded into a physical wireframe model with Ø4mm struts.                                     |
| L100 | Create a composite form combining a Gyroid TPMS infill, a geodesic outer shell (frequency 4), and a diagrid structural cage — all within a 200mm sphere. |

---
