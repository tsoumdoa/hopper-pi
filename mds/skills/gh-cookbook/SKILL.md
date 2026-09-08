---
name: gh-cookbook
description: Supplemental Grasshopper recipes for surfaces, subdivision, edges, lofts, extrusions, pipes, point patterns, projection, and reusable bake pipelines. Use with gh-modeling-expert for a matching task.
---

# Grasshopper cookbook

Follow [gh-modeling-expert](../gh-modeling-expert/SKILL.md) for document context, building, layout, and verification. Read only recipes needed for the requested output; combine them in one new-subgraph request when possible.

Recipe diagrams describe data flow. Resolve unfamiliar component names and ports against the current library; diagram labels are not guaranteed tool selectors. Dimensions use the current model units. Preserve branch structure unless the requested result requires changing it.

| Recipe | Result |
|--------|--------|
| [0. Rectangle surface](./reference/recipe-0-rectangle-surface.md) | Planar surface with adjustable dimensions |
| [1. Subdivide surface](./reference/recipe-1-subdivide-surface.md) | U×V patches |
| [2. Extract edges](./reference/recipe-2-extract-edges.md) | All edges or sets by topology |
| [3. Loft curves](./reference/recipe-3-loft-curves.md) | Surface through ordered profiles |
| [4. Extrude](./reference/recipe-4-extrude.md) | Geometry extruded along a vector |
| [5. Pipe / sweep](./reference/recipe-5-pipe-sweep.md) | Tubes or swept sections |
| [6. Dispatch pattern](./reference/recipe-6-dispatch-pattern.md) | Two patterned subsets |
| [7. Populate points](./reference/recipe-7-populate-points.md) | Surface grid or random points |
| [8. Project points](./reference/recipe-8-project-points.md) | Points projected onto geometry |
| [9. Bake pipeline](./reference/recipe-9-bake-geometry.md) | Named-layer model content for Rhino |

For maintainers: [recipe authoring](./reference/GUIDELINES.md) and [benchmark prompts](../../../docs/gh-cookbook-benchmarks.md).
