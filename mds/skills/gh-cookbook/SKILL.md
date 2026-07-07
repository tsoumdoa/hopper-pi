---
name: gh-cookbook
description: Repeatable recipe cards for Grasshopper patterns — rectangle surface, UV subdivision, edges, loft, extrude, pipe/sweep, dispatch, populate points, projection, bake. Use when the user asks to build these workflows.
---

# Grasshopper Cookbook

## Role

Pattern library — each recipe is a self-contained build card (components, wiring, zone map, next steps). Load one recipe file per task.

## How to use

1. Match the user's goal to a recipe below.
2. Load the recipe file when the table summary is not enough to build confidently.
3. Layout and placement → [gh-modeling-expert](../gh-modeling-expert/SKILL.md) (tiers, gaps, read-once, preview).
4. Place all components → `gh_get_canvas` once → wire everything.
5. Consult **Next Steps** only if the requested outcome requires recipe chaining or the user asks for it.

**QA / benchmark prompts (humans):** [docs/gh-cookbook-benchmarks.md](../../../docs/gh-cookbook-benchmarks.md)

## Recipes

| # | Recipe | Summary |
|---|--------|---------|
| **0** | [Rectangle Surface](./reference/recipe-0-rectangle-surface.md) | Planar rectangle via plane + U/V domain |
| **1** | [Subdivide Surface](./reference/recipe-1-subdivide-surface.md) | U×V grid of subsurface patches |
| **2** | [Extract Edges](./reference/recipe-2-extract-edges.md) | Edge curves by type (outer vs interior) |
| **3** | [Loft Curves](./reference/recipe-3-loft-curves.md) | Lofted surface through 2+ profiles |
| **4** | [Extrude](./reference/recipe-4-extrude.md) | Linear extrusion along a vector |
| **5** | [Pipe / Sweep](./reference/recipe-5-pipe-sweep.md) | Pipe radius or custom sweep section |
| **6** | [Dispatch Pattern](./reference/recipe-6-dispatch-pattern.md) | A/B split with boolean pattern |
| **7** | [Populate Points](./reference/recipe-7-populate-points.md) | Grid or random points on surface |
| **8** | [Project Points](./reference/recipe-8-project-points.md) | Ray-cast points onto geometry |
| **9** | [Bake Geometry](./reference/recipe-9-bake-geometry.md) | Bake to Rhino doc on a named/colored layer via Model Object + Model Layer |

## New recipes

Authoring checklist → [reference/GUIDELINES.md](./reference/GUIDELINES.md) (human maintainers).
