# Layout System — Bounds-Based Placement

> **When to use this file:** Load this file only for **Tier 3 (complex)**
> definitions (25+ components, multiple data paths, scripts), or when
> placement goes wrong and you need to debug layout issues. For Tier 1–2
> tasks, the Component Size Table in SKILL.md is usually sufficient.

All layout decisions must use **bounds**, never pivot. Every component reports
`bounds: x y w h` where `(x,y)` is the top-left corner and `(w,h)` is the
full rendered size.

## General Principles
- Group related components by function, it should have clear inputs and outputs.
- Do not group a component that is a part of other groups; nested groups
  allowed only if all components are in the same group.
- No overlapping components.
- Keep the canvas readable and avoid unnecessary wire crossings - use faint or
  hidden wires.
- More generous spacing horizotanlly  and tighter spacing vertically between components.
- Do ajust size of panel according to content length.


## Placement Protocol (Tier 3 — mandatory for complex definitions)

Placement is the most error-prone part of canvas construction. Follow this
protocol for **Tier 3** definitions, or when layout correctness is critical:

### 1. Build first, read only when necessary
For a fresh build: compute zone gaps from your math and the Component Size
Table. Do not read the canvas between zones. Only read when placing adjacent
to existing components you didn't place yourself and need their actual bounds.

### 2. State the math explicitly
Before every placement, write out the reasoning:
- Which existing component's bounds you are deriving from
- What gap value you are applying (H_GAP or H_GAP_TIGHT)
- The resulting x and y values

Example:
```
Zone 1 right edge:  max(20+182) = 202 (Fold Depth slider)
Zone 2 x:           202 + 50 = 252
Input slider center: (20 + 200) / 2 = 110
Script pivot y:     110  (vertically centered on feeding group)
```



### 3. One zone per step
Place all components in one zone → verify no overlaps mentally or via
`gh_get_canvas_errors` → **then** compute and place the next zone. Never
place components across multiple horizontal zones in a single step.

### 4. After all zones: read once for GUIDs
After ALL zones are placed, call `gh_get_canvas` once to get GUIDs for wiring.
Do NOT read between zones.


## Horizontal Zones (left-to-right flow)

Divide the canvas into logical zones. Each zone's start-x is derived from the
previous zone's right edge plus a gap:

```
zone2_x = max(member.x + member.w for member in zone1) + H_GAP
zone3_x = max(member.x + member.w for member in zone2) + H_GAP
```

Standard gaps (authoritative values live in SKILL.md):
- `H_GAP = 50` px between zones (parameters → processing → output)
- `H_GAP_TIGHT = 30` px between tightly coupled components (e.g. swatch → material)

Typical zone arrangement:
1. **Parameters zone** (far left) — sliders, toggles, panels, value lists
2. **Processing zone** (center) — math, logic, script components, geometry ops
3. **Output / Preview zone** (right) — swatch, material, custom preview

## Vertical Stacking Within a Zone

Components in the same column stack top-to-bottom with consistent spacing:

```
next_y = prev_bounds.y + prev_bounds.h + V_GAP
```

Where:
- `V_GAP = 40` px for uniform-height components (e.g. sliders: h=20 each)
- For mixed-height components in the same logical "row", **center vertically**
  relative to the tallest neighbor:

```
row_center_y = tallest.y + tallest.h / 2
centered_y = row_center_y - shorter.h / 2
```

This ensures a 144px-tall script node and a 20px slider in adjacent columns
align visually along their midlines rather than their top edges.

## Group Bounds

Groups must tightly wrap their member components with uniform padding:

```
group_x   = min(m.x for m in members) - GROUP_PAD
group_y   = min(m.y for m in members) - GROUP_PAD
group_w   = max(m.x + m.w for m in members) - group_x + GROUP_PAD * 2
group_h   = max(m.y + m.h for m in members) - group_y + GROUP_PAD * 2
```

Where `GROUP_PAD = 8` px. Groups should feel like a snug container, not a
loose bounding box with excessive margin.

## Preview Pipeline Spatial Contract

The preview output always follows this spatial pattern:

```
  [Colour Swatch]──→[Create Material]──┐
                                      ├──→[Custom Preview]
  [Geometry out] ──────────────────────┘
```

Placement rules for the preview cluster:
1. **Colour Swatch**: placed to the **left** of Create Material,
   vertically aligned to the `Kd` (diffuse) input port.
2. **Create Material**: placed to the **left** of Custom Preview,
   with its `M` output routing horizontally into the preview's `M` input.
3. **Custom Preview**: the rightmost component. Its `G` (geometry) input
   receives the main data stream from the processing zone.
4. All three form a tight cluster — use `H_GAP_TIGHT` between them.
5. The entire preview cluster sits in its own group.

## Component Size Awareness

Different component types have very different sizes. Use the Component Size
Table for placement estimates. Only read actual bounds when placing adjacent
to existing components you didn't place yourself:

| Component type | Typical size | Notes |
|---|---|---|
| Slider | ~160 × 20 | Uniform height, variable width by range |
| Toggle | ~50 × 20 | Small — stack multiple per row if needed |
| Panel (single-line) | ~80–200 × 20 | Width varies by content length |
| Panel (multi-line) | variable × variable | Place near consumer |
| Value List | ~100 × 20 | Similar to toggle |
| Colour Swatch | ~120 × 20 | Fixed small height |
| Create Material | ~65 × 105 | Tall — accounts for Kd/Ks/Ke/T/S inputs |
| Custom Preview | ~45 × 60 | Compact square-ish |
| Script (Python/C#) | ~90 × 140+ | Grows with number of inputs/outputs |
| Math / Params | ~40–60 × 25–45 | Varies by type |

When placing next to a tall component (script, material), use vertical
centering so the visual weight balances.

**Vertical centering calculation for adjacent zones:**
When a tall component (e.g. script, ~118px) is placed next to a stack of
short components (e.g. sliders, ~20px each), compute the vertical center
of the feeding group explicitly:

```
group_top    = min(component.y for component in feeding_group)
group_bottom = max(component.y + component.h for component in feeding_group)
center_y     = (group_top + group_bottom) / 2
pivot_y      = center_y
```

Do not top-align with the first slider. Use the midpoint of the group.

## Pivot vs. Bounds — Avoid Negative-Space Overflow

The `x`, `y` values you pass to `gh_edit_components` are **pivot** positions,
not top-left corners. For tall components (Rectangle, Scripts, Create Material,
Boundary Surfaces), the rendered bounds can extend 40–70 px above and to the
left of the pivot. If you place a tall component at `y=20`, its bounds may
start at `y=-20` — leaking into negative space.

Rules:
- Use a **minimum safe pivot y of 45** for the first row of components.
- For tall components specifically, use `y ≥ 65` or read actual bounds after
  placement to verify all bounds stay ≥ 0.
- After placing components (especially tall ones), check for bounds extending
  below 0 if you suspect overflow. Use `gh_get_canvas_errors` to detect
  overlaps rather than reading the full canvas.
- The same applies horizontally: a component pivot at `x=20` may produce bounds
  at `x=-5`. Use `x ≥ 25` as a minimum safe value.

**Worked example — 5-component flow with preview (Slider → Circle → Boundary → Area + Preview cluster):**
```
Slider:    x=25,  y=45,  w≈100  →  right edge = 125
Circle:    x = 125 + 50 = 175,  w≈56  →  right edge = 231
Boundary:  x = 231 + 50 = 281,  w≈55  →  right edge = 336
Area:      x = 336 + 50 = 386,  w≈57  →  right edge = 443

Preview cluster (output zone, one V_GAP below Area's vertical center):
  Swatch:   x = 443 + 30 = 473,  y = Area.pivot_y + V_GAP
  Preview:  x = 473 + 86 + 30 = 589,  same y   (swatch w≈86 + H_GAP_TIGHT)
```
Rule: **right-edge of previous + gap = x of next.** Always compute, never guess.
Preview always goes in the output zone — right of the last flow component.
