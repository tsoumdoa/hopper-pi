---
name: gh-modeling-expert
description: Primary workflow for creating, editing, debugging, reviewing, or organizing Grasshopper definitions, including GH C#/Python script components. Use for Grasshopper canvas work; load gh-cookbook only as a supplemental matched recipe.
---

# Grasshopper Modeling Expert

## Role

Build, modify, review, or validate Grasshopper definitions per the user's request.

**Rhino vs Grasshopper:** This skill is **Grasshopper canvas only** (`gh_*`). Directly commit current geometry to Rhino with `rh_run_script`; build a reusable parametric bake pipeline inside Grasshopper with [Cookbook Recipe 9](../gh-cookbook/reference/recipe-9-bake-geometry.md). Use `rh_view_control` for normal viewport/camera changes. If "bake" is ambiguous and either outcome is plausible, ask the user which result they want.

## Complexity tiers

Assess tier before building. When tier is ambiguous **and** the choice materially changes geometry, data loss, or user-visible output, ask the user to confirm scope before placing components. Otherwise proceed with the documented default and state the assumption briefly.

| Tier | When | New-build action | Read canvas |
|------|------|------------------|-------------|
| **1** | ≤10 components, linear | One `gh_apply_graph` call | Not normally needed |
| **2** | 10–25, branching | One `gh_apply_graph` call | Not normally needed |
| **3** | 25+, scripts, many paths | Plan by zone, then one `gh_apply_graph` call | Only for unresolved existing context |

**Default new-build workflow:** resolve unusual/ambiguous types if necessary → call `gh_apply_graph` once → inspect its integrated validation → use legacy tools only for surgical repair. Local refs replace the old placement readback. For existing-canvas edits, targeted reads (`selectionOnly`, `subgraph`) are appropriate.

## Gaps and compact size table

| Constant | Value | Use |
|----------|-------|-----|
| `H_GAP` | 50px | Between zones (params → processing → output) |
| `H_GAP_TIGHT` | 30px | Swatch → preview, tightly coupled pairs |
| `V_GAP` | 40px | Stacked components in a column |

| Type | ~size | Notes |
|------|-------|-------|
| Slider / Toggle / Swatch | ~160×20, ~50×20, ~120×20 | Short — stack in params zone |
| Panel | ~80–200×20 | `textOutput: "singleString"` or `"oneItemPerLine"` (required) |
| Custom Preview | ~45×60 | Output zone, rightmost |
| Create Material | ~65×105 | Optional — see preview default below |
| Script (C#/Python) | ~90×140+ | Tall — center on feeding group midpoint |

Full table, bounds math, pivot safety, worked examples → [layout-system.md](../../reference/layout-system.md) (load for Tier 3 or layout bugs).


## Conventions (checklist)

- Left-to-right flow; no right-to-left wires; no recursive logic.
- Do not touch components in negative canvas space.
- Tier 3: compute placement math internally and submit all zones together. Summarize by zone only if useful.
- Stack numeric inputs top-left. Panels: default ~100×52; adjust to content.
- `preview: false` on add; only Custom Preview in output zone uses `preview: true`.
- Prefer C# for scripts; Python for simple list/tree utilities only.
- Only add components that serve a purpose.

## Progressive reference

| Need | File | Path |
|------|------|------|
| Atomic new-subgraph API and validation | [apply-graph.md](../../reference/apply-graph.md) | `mds/reference/apply-graph.md` |
| Tier 3 layout, preview placement, bounds | [layout-system.md](../../reference/layout-system.md) | `mds/reference/layout-system.md` |
| Sub-graph filters (`subgraph`, `selectionOnly`) | [canvas-navigation.md](../../reference/canvas-navigation.md) | `mds/reference/canvas-navigation.md` |
| C# script node | [csharp-boilerplate.md](../../reference/csharp-boilerplate.md) | `mds/reference/csharp-boilerplate.md` |
| Python script node | [python-boilerplate.md](../../reference/python-boilerplate.md) | `mds/reference/python-boilerplate.md` |
| Script create/rename lifecycle | [script-component-lifecycle.md](../../reference/script-component-lifecycle.md) | `mds/reference/script-component-lifecycle.md` |
| Type casts, panel input formats | [data-type-guide.md](../../reference/data-type-guide.md) | `mds/reference/data-type-guide.md` |
| Common GH patterns (recipes) | [gh-cookbook](../gh-cookbook/SKILL.md) | `mds/skills/gh-cookbook/SKILL.md` |

## Modeling defaults

- Units: **mm** unless specified.
- 3D geometry: **Breps** unless specified.
- Solids: prefer extrude, pipe, sweep, loft over heavy booleans.

## Common problems
- **Python tree/list boundary** — inspect the integrated `gh_apply_graph` runtime messages for a new graph, or run `gh_get_canvas_errors` for existing nodes, then follow [python-boilerplate.md](../../reference/python-boilerplate.md#list-vs-tree-access-types).
- Extruded crvs result in open breps, you need to extrude them as srf or cap
  them.

## User clarification

When the user's intent is ambiguous, prefer documented defaults and state assumptions. Ask only when the answer materially changes output, destructive edits, or repair strategy:

Ask a short, direct question when vague scope, multiple component matches, ambiguous target references, or an unclear repair strategy would change the result. For Tier 2-3 planning, ask only about the highest-impact unresolved choices. Do not ask about layout spacing, slider ranges, or standard Custom Preview patterns.

Before `gh_param_rhino` **internalize** on more than 10 objects or a whole layer, ask the user to confirm reference vs internalize.

## Final checklist

For newly built or touched components only; do not reorganize unrelated canvas areas unless requested.

- Delete unused touched components; fix errors; no overlaps.
- Inputs (sliders, panels, toggles) on the left; logical left-to-right flow.
- Group by function when it helps readability.
- Hide intermediates; only final Custom Preview visible.
- Swatch for preview color unless full material is required.
