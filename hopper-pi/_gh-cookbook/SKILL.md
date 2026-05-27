---
name: gh-cookbook
description: Repeatable recipe cards for common Grasshopper patterns — rectangle from plane/domain, surface subdivision, edge extraction, lofting, extrusion, piping, dispatch/patterning, point population, projection, and more. Use when the user asks to build any of these typical workflows.
---

# Grasshopper Cookbook

## Role
You are a pattern library, not a theory textbook. Each recipe is a **self-contained build card** in its own file: components, wiring, zone map, data flow, and typical next steps. Load the recipe you need — no cross-references required.

## How to use
1. Match the user's goal to a recipe below.
2. **Load that recipe file** (it contains everything needed — components, wiring, layout).
3. Follow the **Layout Contract** below for where everything goes.
4. Place all components first → `gh_get_canvas` once → wire everything (per [gh-modeling-expert](./gh-modeling-expert/SKILL.md) tier rules).
5. Check the recipe's "Typical next steps" for where the output usually feeds into.

---

## Mandatory Layout Contract (applies to ALL recipes)
Every recipe must follow the 3-zone layout system in a strict left-to-right flow: parameters → processing → output. 
Use the required gap rules (`H_GAP=50`, `H_GAP_TIGHT=30`, `V_GAP=40`), bounds-based placement math, right-side preview clustering, logical grouping.

---

## Recipes

| # | Recipe | File | One-line summary |
|---|--------|------|------------------|
| **Surface & Domain Basics** | | | |
| **0** | [Rectangle Surface from Plane + Domain](./reference/recipe-0-rectangle-surface.md) | `recipe-0-rectangle-surface.md` | Planar rectangle via plane + U/V domain — the standard starting surface |
| **1** | [Subdivide Surface by UV Domain](./reference/recipe-1-subdivide-surface.md) | `recipe-1-subdivide-surface.md` | Split surface into U×V grid of subsurface patches |
| **Curve & Edge Operations** | | | |
| **2** | [Extract & Organize Edges](./reference/recipe-2-extract-edges.md) | `recipe-2-extract-edges.md` | Get edges from surfaces/breps by type (outer vs interior) |
| **3** | [Loft Between Curves](./reference/recipe-3-loft-curves.md) | `recipe-3-loft-curves.md` | Lofted surface through 2+ profile curves |
| **Form Generation** | | | |
| **4** | [Extrude Curves / Surfaces](./reference/recipe-4-extrude.md) | `recipe-4-extrude.md` | Linear extrusion along a direction vector |
| **5** | [Pipe / Sweep Profile](./reference/recipe-5-pipe-sweep.md) | `recipe-5-pipe-sweep.md` | Tubular radius around curves or custom sweep section |
| **Patterning & Distribution** | | | |
| **6** | [Dispatch / Pattern Alternation](./reference/recipe-6-dispatch-pattern.md) | `recipe-6-dispatch-pattern.md` | Split list into A/B with boolean pattern for checkerboards etc. |
| **7** | [Populate Points on Surface](./reference/recipe-7-populate-points.md) | `recipe-7-populate-points.md` | Grid or random point distribution across a surface |
| **Projection** | | | |
| **8** | [Project Points onto Geometry](./reference/recipe-8-project-points.md) | `recipe-8-project-points.md` | Ray-cast points onto a surface along a direction vector |

---

## Composition Examples

These show how recipes chain together in real workflows.

### Facade Screen (Recipe 0 → 1 → 4 → 6)
```
Recipe 0 (Rectangle) → Divide Domain² (5×8) → Isotrim
                                        ├→ Dispatch (alternating)
                                        │    ├→ A → Extrude(height=30) → CustomPreview(white)
                                        │    └→ B → CustomPreview(grey)
                                        └→ (original patches remain flat)
```
Result: A building facade where every other panel projects outward.

### Structural Grid (Recipe 0 → 1 → 2 → 5a)
```
Recipe 0 (Rectangle) → Divide Domain² (N×M) → Isotrim → Deconstruct Brep
                                                    └→ E (edges) → Pipe(R=0.15)
```
Result: A piped-edge grid following surface curvature — like a space-frame or glazed roof structure.

### Surface Studs (Recipe 7 → Evaluate Surface → 5a)
```
Surface → Divide Surface (U=12, V=12) → Pt
                                            ├→ Evaluate Surface(S=surface, uv=UV)
                                            │    └→ N (normals)
                                            └→ Line SDL(P=Pt, D=N, L=length)
                                                 └→ Pipe(R=radius)
```
Result: Normal-aligned pipes radiating from a surface — like an acoustic baffle or decorative quill field.

---

## Guidelines for Adding New Recipes

See [reference/GUIDELINES.md](./reference/GUIDELINES.md) for the full recipe authoring checklist and template.
