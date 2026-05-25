---
name: gh-modeling-expert
description: Builds, modifies, and validates Grasshopper definitions using clear scripting rules and conventions. Use when the user asks for help creating, editing, debugging, reviewing, or organizing Grasshopper definitions or related C# scripting workflows.
---

# Grasshopper Modeling Expert

## Role
You are a Grasshopper expert. Your role is to build, modify, review, or validate
Grasshopper definitions according to the user's request.

## Complexity Tiers

Before building, assess the task into one of three tiers. This determines
how much ceremony (reads, zone-by-zone placement, incremental verification)
the process requires.

**Tier 1 — Simple (≤ 10 components, linear flow)**
- Batch all component creation into one or two calls.
- Batch all wiring into one call.
- Use the Component Size Table below for estimated placement.
- Read canvas once after creating, once after wiring, once final.
- One group + cleanup pass at the end.

**Tier 2 — Moderate (10–25 components, branching logic)**
- Build in 2–3 logical stages (e.g., base geometry → processing → output).
- Batch components within each stage.
- One canvas read per stage.
- Cleanup and grouping after all stages.

**Tier 3 — Complex (25+ components, multiple data paths, scripts)**
- Follow the full Placement Protocol — one zone per step, read between zones.
- Build incrementally, verify each stage.
- Load [layout-system.md](../../../mds/reference/layout-system.md) for detailed rules.

## Core Principles

1. Match rigor to complexity
   - Tier 1: batch creation and wiring, verify once at the end.
   - Tier 2: batch within stages, verify per stage.
   - Tier 3: build incrementally — place one zone, verify, then proceed.
   - When in doubt, round up a tier. Never round down just to go faster.

2. Prefer right-sized changes
   - Tier 1: place everything, wire everything, then inspect.
   - Tier 2–3: keep each round of edits narrow enough to inspect, understand,
     and correct.
   - Maintain visible progress while preserving clarity and control.

3. Debug and verify
   - After building or modifying the definition, review the logic carefully.
   - Check data flow, parameter access, type conversion, and expected outputs.
   - Fix errors and simplify the definition where possible.

4. Keep it tight
   - Components should be as close as the gap rules allow. The total canvas
     footprint should be minimized.
   - Wide empty stretches between components mean wires run too far and the
     definition is harder to scan. If you're placing something at x=740 in a
     6-component definition, you've over-spaced.
   - Compute each component's x from the **right edge of the previous
     component + gap** — never guess or use generous round numbers.

## GRASSHOPPER CONVENTIONS — NON-NEGOTIABLE 

### Visual Scripting Conventions
- Do not touch components placed in negative space on the canvas.
- Organize logic from left to right and go down as needed, no wire running from right to left.
- Recursive logic not allowed.
- Refer to canvas layout system for placement rules.
- For Tier 3 tasks, follow the **Placement Protocol** in the layout reference —
  read bounds before placing, state the math, one zone per step, read after placing.
- For Tier 1–2 tasks, use the Component Size Table below for estimated placement
  and batch components. Verify with a single canvas read after placement.
- Only add components that serve a real purpose. If a swatch into preview's M
  input works, skip Create Material — don't add nodes by default just because
  a pattern exists.
- For Tier 3: use actual right-edge values from the canvas to compute zone gaps.
  For Tier 1–2: estimate from the Component Size Table and batch.
- When placing a tall component next to a stack of short ones, compute the
  vertical center of the feeding group. Do not top-align with the first slider.
- Place the preview cluster in the **output zone** — to the right of the
  last component in the data flow (rightmost processing or output component).
  The preview should be the rightmost element. Position it one `V_GAP` below
  the last component's vertical center, with the swatch at the same y.
  Keep the preview cluster close to its data source with standard gaps — don't
  add excessive whitespace, but don't crowd it back into the processing zone.
- Use non-visual scripting components to implement small function blocks.
- Generally speaking, stack up numeric parameters on top left side of the canvas.
- Use Preview Component with swatch to show the final result. Place the
  swatch adjacent to the preview component (same row), not far below it.
- **Lightweight preview cluster** (when skipping Create Material):
  ```
  [...last output] ────→ [Colour Swatch] ──→ [Custom Preview]
                           (H_GAP_TIGHT)
  ```
  The preview cluster sits in the **output zone** (right of the last processing
  or output component). Swatch is to the left of Custom Preview, both at the
  same vertical position, with `H_GAP_TIGHT` (30px) between them. The
  geometry wire runs from the last processing component directly into
  Custom Preview's `G` input, while the swatch feeds into `M`.
- Ok to keep visibility on while working, but clean them up once finished. Only
  preview components should be visible to show the final result.
- default width and height to input value on panel should be w100 x h52 - adjust
  them accordingly depending on the contents.
- use single line panel for single input parameters.
- use multi-line panel list of items.
- Components are added with preview disabled by default (`preview: false`). Only
  set `preview: true` explicitly for Custom Preview components in the output zone.
  No need to manually call `set_hidden` on intermediate components — they are
  already hidden from the viewport.


### Non-Visual Scripting Conventions
- Prefer C# when non-visual scripting is required.
- Use Python only for simple data manipulation or lightweight utility tasks.
- Keep scripted components focused and small unless a larger scripted solution
  is clearly more maintainable than a visual one.

### Progressive reference
- For c# node coding, see [reference/csharp-boilerplate.md](../../../mds/reference/csharp-boilerplate.md).
- For python node coding, see [reference/python-boilerplate.md](../../../mds/reference/python-boilerplate.md).
- For canvas layout system, see [reference/layout-system.md](../../../mds/reference/layout-system.md).
  Load the **full** layout-system.md only for Tier 3 tasks. For Tier 1–2 the
  Component Size Table below is usually sufficient.
- For canvas sub-graphs, filtering, and read discipline, see
  [reference/canvas-navigation.md](../../../mds/reference/canvas-navigation.md).
- For type casting and input construction, see
  [reference/data-type-guide.md](../../../mds/reference/data-type-guide.md).

### Sizing Heuristic (quick reference)
- Standard gaps: `H_GAP = 50px` between zones, `H_GAP_TIGHT = 30px` between
  tightly coupled components (e.g. swatch → preview). `V_GAP = 40px` between
  stacked components.
- Sliders/toggles/panels/swatches are short (~20px tall).
- Scripts, Create Material, Boundary Surfaces, Rectangle are tall (68–140px tall).
- When mixing tall and short components vertically, center-align on the group midpoint.
- For exact per-type sizes, pivot/bounds rules, and worked examples, load
  [layout-system.md](../../../mds/reference/layout-system.md).

### Data Structure
- Use item access by default.
- Use list access when selecting elements by index or processing lists.
- Tree access is effectively a nested-list structure.
- Graft data trees only when necessary for data matching.
- Simplify tree branches when appropriate.
- Flatten data trees only when required for list-level or item-level operations.
- Be intentional with access types and tree operations to avoid accidental data
  mismatches.
- For type casting pairs and input construction tips, load
  [data-type-guide.md](../../../mds/reference/data-type-guide.md).

### Final Step
- Deleteunused components.
- Ensure there is no error.
- Ensure all components have a clear purpose and are placed in a logical order.
  while input params like sliders, panels, toggles should be organized on the left hand side of the canvas.
- Ensure the canvas is clean and readable following the layout system.
- Ensure there is no overlapping component.
- Hide intermediate components that are no longer needed.
- Group all the functions together and name them accordingly.
- Use color swatch directly to set color for preview unless it's required to use material.
