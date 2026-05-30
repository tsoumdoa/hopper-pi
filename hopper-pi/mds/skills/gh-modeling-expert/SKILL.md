---
name: gh-modeling-expert
description: Builds, modifies, and validates Grasshopper definitions using clear scripting rules and conventions. Use when the user asks for help creating, editing, debugging, reviewing, or organizing Grasshopper definitions or related C# scripting workflows.
---

# Grasshopper Modeling Expert

## Role

Build, modify, review, or validate Grasshopper definitions per the user's request.

**Rhino vs Grasshopper:** Viewport geometry, layers, bake, Rhino scripts → `rh_run_script` ([rhino-document](../rhino-document/SKILL.md)). This skill is **Grasshopper canvas only** (`gh_*` tools).

## Complexity tiers

Assess tier before building. When in doubt, round **up**.

| Tier | When | Placement | Read canvas |
|------|------|-----------|-------------|
| **1** | ≤10 components, linear | Batch create in 1–2 calls | Once after **all** placed |
| **2** | 10–25, branching | 2–3 stages; batch per stage | Once after **all** stages placed |
| **3** | 25+, scripts, many paths | One zone per step; [Placement Protocol](../../reference/layout-system.md) | Once after **all** zones placed |

**Workflow (all tiers):** place everything → `gh_get_canvas` once → wire everything → cleanup.

## Gaps and compact size table

| Constant | Value | Use |
|----------|-------|-----|
| `H_GAP` | 50px | Between zones (params → processing → output) |
| `H_GAP_TIGHT` | 30px | Swatch → preview, tightly coupled pairs |
| `V_GAP` | 40px | Stacked components in a column |

| Type | ~size | Notes |
|------|-------|-------|
| Slider / Toggle / Swatch | ~160×20, ~50×20, ~120×20 | Short — stack in params zone |
| Panel | ~80–200×20 | Single-line for one value; multi-line for lists |
| Custom Preview | ~45×60 | Output zone, rightmost |
| Create Material | ~65×105 | Optional — see preview default below |
| Script (C#/Python) | ~90×140+ | Tall — center on feeding group midpoint |

Full table, bounds math, pivot safety, worked examples → [layout-system.md](../../reference/layout-system.md) (load for Tier 3 or layout bugs).

## Core principles

1. **Place first, read once, wire, done** — Add **all** components before `gh_get_canvas`. One read per build cycle for GUIDs, then batch all wiring. Exception: debug after wiring (`gh_get_canvas_errors` first, then read if needed). `selectionOnly` inspects user selection only — not a substitute for the post-placement read.

2. **Batch by zone, wire after read** — Group placement logically (params, processing, output). Do **not** wire until after the single `gh_get_canvas` read.

3. **Tight, computed layout** — `next_x = prev_right_edge + gap`. Never guess x from round numbers. Minimize footprint; wide empty gaps mean over-spacing.

4. **Preview default (lightweight)** — Output zone, right of last processing component: geometry → Custom Preview `G`; Colour Swatch → `M` with `H_GAP_TIGHT` between swatch and preview. Skip Create Material unless material properties beyond diffuse color are required. Spatial details → [layout-system.md](../../reference/layout-system.md).

5. **Data discipline** — Item access by default; list/tree when needed. Graft/simplify/flatten intentionally. Use `gh_edit_param` `editAccessType` for access and mapping. Casts and panel tricks → [data-type-guide.md](../../reference/data-type-guide.md).

## Conventions (checklist)

- Left-to-right flow; no right-to-left wires; no recursive logic.
- Do not touch components in negative canvas space.
- Tier 3: state placement math; one zone per step; `gh_get_canvas_errors` OK between zones; **no** `gh_get_canvas` between zones.
- Stack numeric inputs top-left. Panels: default ~100×52; adjust to content.
- `preview: false` on add; only Custom Preview in output zone uses `preview: true`.
- Prefer C# for scripts; Python for simple list/tree utilities only.
- Only add components that serve a purpose.

## Progressive reference

| Need | File |
|------|------|
| Tier 3 layout, preview placement, bounds | [layout-system.md](../../reference/layout-system.md) |
| Sub-graph filters (`subgraph`, `selectionOnly`) | [canvas-navigation.md](../../reference/canvas-navigation.md) |
| C# script node | [csharp-boilerplate.md](../../reference/csharp-boilerplate.md) |
| Python script node | [python-boilerplate.md](../../reference/python-boilerplate.md) |
| Script create/rename lifecycle | [script-component-lifecycle.md](../../reference/script-component-lifecycle.md) |
| Type casts, panel input formats | [data-type-guide.md](../../reference/data-type-guide.md) |
| Common GH patterns (recipes) | [gh-cookbook](../gh-cookbook/SKILL.md) |

## Modeling defaults

- Units: **mm** unless specified.
- 3D geometry: **Breps** unless specified.
- Solids: prefer extrude, pipe, sweep, loft over heavy booleans.

## Final checklist

- Delete unused components; fix errors; no overlaps.
- Inputs (sliders, panels, toggles) on the left; logical left-to-right flow.
- Group by function; name groups.
- Hide intermediates; only final Custom Preview visible.
- Swatch for preview color unless full material is required.
