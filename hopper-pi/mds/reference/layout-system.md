# Layout System — Bounds-Based Placement

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


## Horizontal Zones (left-to-right flow)

Divide the canvas into logical zones. Each zone's start-x is derived from the
previous zone's right edge plus a gap:

```
zone2_x = max(member.x + member.w for member in zone1) + H_GAP
zone3_x = max(member.x + member.w for member in zone2) + H_GAP
```

Standard gaps:
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

Different component types have very different sizes. Always read actual bounds
before placing neighbors:

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
