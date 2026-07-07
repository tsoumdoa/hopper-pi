---
name: gh-modeling-expert
description: Builds, modifies, and validates Grasshopper definitions using clear scripting rules and conventions. Use when the user asks for help creating, editing, debugging, reviewing, or organizing Grasshopper definitions or related C# scripting workflows.
---

# Grasshopper Modeling Expert

## Reference layout

Shared reference docs live at `mds/reference/` (not under this skill).
- Full path example: `mds/reference/python-boilerplate.md`
- Also reachable via: `mds/skills/gh-modeling-expert/reference/` (symlink)

## Role

Build, modify, review, or validate Grasshopper definitions per the user's request.

**Rhino vs Grasshopper:** Viewport geometry, layers, bake, Rhino scripts → `rh_run_script` ([rhino-document](../rhino-document/SKILL.md)). This skill is **Grasshopper canvas only** (`gh_*` tools).

## Complexity tiers

Assess tier before building. When tier is ambiguous **and** the choice materially changes geometry, data loss, or user-visible output, use `pick_option` to confirm scope before placing components. Otherwise proceed with the documented default and state the assumption briefly.

| Tier | When | Placement | Read canvas |
|------|------|-----------|-------------|
| **1** | ≤10 components, linear | Batch create in 1–2 calls | Once after **all** placed |
| **2** | 10–25, branching | 2–3 stages; batch per stage | Once after **all** stages placed |
| **3** | 25+, scripts, many paths | One zone per step; [Placement Protocol](../../reference/layout-system.md) | Once after **all** zones placed |

**Default new-build workflow:** place everything → `gh_get_canvas` once → wire everything → cleanup touched components. For existing-canvas edits, targeted reads (`selectionOnly`, `subgraph`) are OK when they reduce work.

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

## Core principles

1. **Place first, read once, wire, done** — For a new-build cycle, add all needed components before `gh_get_canvas`. One read gets GUIDs, then batch wiring. Exceptions: existing-canvas edits, user selection/subgraph inspection, and debugging after wiring (`gh_get_canvas_errors` first, then read if needed).

2. **Batch by zone, wire after read** — Group placement logically (params, processing, output). For new builds, wire after the post-placement read.

3. **Tight, computed layout** — `next_x = prev_right_edge + gap`. Never guess x from round numbers. Minimize footprint; wide empty gaps mean over-spacing.

4. **Preview default (lightweight)** — Output zone, right of last processing component: geometry → Custom Preview `G`; Colour Swatch → `M` with `H_GAP_TIGHT` between swatch and preview. Skip Create Material unless material properties beyond diffuse color are required. Spatial details → [layout-system.md](../../reference/layout-system.md).

5. **Data discipline** — Item access by default; list/tree when needed. Graft/simplify/flatten intentionally. Use `gh_edit_param` `editAccessType` for access and mapping. Casts and panel tricks → [data-type-guide.md](../../reference/data-type-guide.md).

## Conventions (checklist)

- Left-to-right flow; no right-to-left wires; no recursive logic.
- Do not touch components in negative canvas space.
- Tier 3: compute placement math internally; summarize by zone only if useful. `gh_get_canvas_errors` OK between zones; avoid full `gh_get_canvas` between zones during new builds.
- Stack numeric inputs top-left. Panels: default ~100×52; adjust to content.
- `preview: false` on add; only Custom Preview in output zone uses `preview: true`.
- Prefer C# for scripts; Python for simple list/tree utilities only.
- Only add components that serve a purpose.

## Progressive reference

| Need | File | Path |
|------|------|------|
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
- **Python tree/list boundary** — if you see `Data conversion failed from Goo to …`, a Python script likely returned a plain list instead of a DataTree. Use `th.tree_to_list` on tree inputs and `th.list_to_tree` on tree outputs. Run `gh_get_canvas_errors` for an inline hint. Recipes → [python-boilerplate.md](../../reference/python-boilerplate.md#list-vs-tree-access-types).
- Extruded crvs result in open breps, you need to extrude them as srf or cap
  them.

## User clarification tools

When the user's intent is ambiguous, prefer documented defaults and state assumptions. Ask only when the answer materially changes output, destructive edits, or repair strategy:

| Situation | Tool |
|-----------|------|
| Vague scope with materially different outcomes ("fix this", "clean up", multiple interpretations) | `pick_option` |
| 2+ plausible component types after `gh_list_components` and the choice changes the result | `pick_option` for the type to create (value = typeGuid) |
| "This/that/the" refers to multiple canvas objects | `pick_option` after `gh_get_canvas` (value = targetId) |
| Tier 2–3 build planning with unresolved scope, approach, or output choices | `pick_option` for the highest-impact choices only (max 2 calls total) |
| Errors after wiring — repair strategy unclear | `pick_option` (surgical fix / rebuild / stop) |
| Open-ended clarification with no good options | `ask_user` (free-text question) |

**Limits:** Max 2 `pick_option`/`ask_user` calls per turn unless the user wants collaboration. For Tier 2–3 planning, ask only choices that materially change the build and stay within that cap. `pick_option` needs 2–7 options per call (an "Other" option is always shown for custom answers — do not add it yourself); if you have only one, use `ask_user`. Do not ask about layout spacing, slider ranges, or standard Custom Preview patterns.

Before `gh_param_rhino` **internalize** on >10 objects or a whole layer, use `pick_option` to confirm reference vs internalize.

## Final checklist

For newly built or touched components only; do not reorganize unrelated canvas areas unless requested.

- Delete unused touched components; fix errors; no overlaps.
- Inputs (sliders, panels, toggles) on the left; logical left-to-right flow.
- Group by function when it helps readability.
- Hide intermediates; only final Custom Preview visible.
- Swatch for preview color unless full material is required.
