# Layout System — Bounds-Based Placement

> **When to use:** Tier 3 definitions (25+ components, scripts, multiple paths), or when placement fails. Tier 1–2: use the compact size table in [gh-modeling-expert](../skills/gh-modeling-expert/SKILL.md).

All layout uses **bounds** (`x y w h` top-left + size), not pivot alone.

## General principles

- Group by function; clear inputs/outputs. No nested groups unless all members share one group.
- No overlapping components; minimize wire crossings (faint/hidden wires OK).
- Spacing: `H_GAP` between zones; `V_GAP` between stacked items; `H_GAP_TIGHT` within a tight cluster. Compute from bounds — tight within a zone, standard gap between zones.
- Adjust panel size to content length.

## Placement protocol (Tier 3)

1. **Build first** — Compute gaps from size table; no `gh_get_canvas` between zones. `gh_get_canvas_errors` OK between zones for overlap checks.
2. **State math** — Before each placement: source bounds, gap, resulting x/y.
3. **One zone per step** — Place all components in one zone, then the next. Never span multiple horizontal zones in one step.
4. **Read once** — After ALL zones placed: `gh_get_canvas` once for GUIDs, then wire.

## Horizontal zones

```
zone2_x = max(m.x + m.w for m in zone1) + H_GAP
```

Gaps (also in gh-modeling-expert): `H_GAP=50`, `H_GAP_TIGHT=30`, `V_GAP=40`.

1. **Parameters** — sliders, toggles, panels
2. **Processing** — math, scripts, geometry ops
3. **Output** — preview cluster (rightmost)

## Vertical stacking

```
next_y = prev_bounds.y + prev_bounds.h + V_GAP
```

Mixed heights in one row — center on tallest:

```
row_center_y = tallest.y + tallest.h / 2
centered_y = row_center_y - shorter.h / 2
```

## Group bounds

`GROUP_PAD = 8`:

```
group_x = min(m.x) - GROUP_PAD
group_y = min(m.y) - GROUP_PAD
group_w = max(m.x + m.w) - group_x + GROUP_PAD * 2
group_h = max(m.y + m.h) - group_y + GROUP_PAD * 2
```

## Preview cluster (output zone)

Right of last processing component. Geometry wire → Custom Preview `G`.

### Default — lightweight (preferred)

```
[Geometry] ──────────────────────→ [Custom Preview]
[Colour Swatch] ──H_GAP_TIGHT──→       M
```

Use when diffuse color via swatch on `M` is enough. Swatch left of preview, same y.

### Optional — with Create Material

```
[Colour Swatch] → [Create Material] ─┐
[Geometry] ────────────────────────┴→ [Custom Preview]
```

Use when Ks/Ke/transparency/etc. matter beyond swatch color. `H_GAP_TIGHT` between cluster nodes.

## Component size table (authoritative)

| Component type | Typical size | Notes |
|----------------|--------------|-------|
| Slider | ~160 × 20 | Variable width |
| Toggle | ~50 × 20 | |
| Panel (single-line) | ~80–200 × 20 | |
| Panel (multi-line) | variable | Near consumer |
| Value List | ~100 × 20 | |
| Colour Swatch | ~120 × 20 | |
| Create Material | ~65 × 105 | Tall |
| Custom Preview | ~45 × 60 | |
| Script (Python/C#) | ~90 × 140+ | Grows with I/O count |
| Math / Params | ~40–60 × 25–45 | |

Center tall components on the feeding group's vertical midpoint — do not top-align to the first slider.

## Pivot vs bounds — negative space

`gh_edit_components` x/y are **pivot** positions. Tall types (Rectangle, Script, Create Material, Boundary Surfaces) can extend 40–70px above/left of pivot.

- First row: pivot `y ≥ 45`; tall components `y ≥ 65`.
- Horizontal: pivot `x ≥ 25`.
- Verify with `gh_get_canvas_errors` if overflow suspected — avoid full canvas read between zones.

**Worked example (Slider → Circle → Boundary → Area + lightweight preview):**

```
Slider:    x=25,  y=45,  w≈100  →  right = 125
Circle:    x=175, w≈56   →  right = 231
Boundary:  x=281, w≈55   →  right = 336
Area:      x=386, w≈57   →  right = 443
Swatch:    x=473, y=Area.pivot_y + V_GAP  (443 + H_GAP_TIGHT from flow end)
Preview:   x=589, same y  (swatch w≈86 + H_GAP_TIGHT)
```

**Rule:** `next_x = prev_right + gap`. Preview always in output zone, right of last flow component.
