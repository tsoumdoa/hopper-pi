# Canvas layout

Use for large or branching graphs, preview placement, and overlap repairs. Plan with bounding boxes, then convert positions to tool pivots.

## Spacing and sizes

Use 50px between zones, 30px between tightly coupled nodes, and 40px vertically. Place inputs, processing, and outputs left to right. Group by function and size panels to content.

| Type | Approximate width × height |
|------|----------------------------|
| Slider | 160 × 20 |
| Toggle | 50 × 20 |
| Panel | 100 × 52 initially; resize to content |
| Value List | 100 × 20 |
| Colour Swatch | 120 × 20 |
| Create Material | 65 × 105 |
| Custom Preview | 45 × 60 |
| Script | 90 × 140 or taller as ports increase |
| Math / Params | 40–60 × 25–45 |

These are estimates. Actual bounds take precedence.

## Bounds and pivots

`gh_apply_graph` and `gh_edit_components` use pivot coordinates. They are not necessarily the top-left corner. Tall or centered components can extend above and left of their pivot.

For bounds `x, y, w, h`:

```text
next_left = previous.x + previous.w + horizontal_gap
next_top = previous.y + previous.h + vertical_gap
next_zone_left = max(node.x + node.w for node in previous_zone) + 50
centered_top = feeding_group_center_y - component_height / 2
pivot_x = desired_left + pivot_offset_x
pivot_y = desired_top + pivot_offset_y
```

Estimate offsets for new nodes; use observed offsets for existing ones. `gh_apply_graph` requires both pivot coordinates to be at least 20, but this alone does not keep bounds out of negative space. Center tall components on the feeding group's midpoint.

For an estimated group box with 8px padding:

```text
left = min(node.x) - 8
right = max(node.x + node.w) + 8
top = min(node.y) - 8
bottom = max(node.y + node.h) + 8
width = right - left
height = bottom - top
```

Hopper creates group bounds from members; these estimates are for placement planning.

## Preview and verification

Place Custom Preview to the right of the last processing node. Connect geometry to `G` and a Colour Swatch to `M`. Add Create Material between the swatch and preview only for extra material properties. Keep intermediates hidden.

Submit the planned graph together and inspect `gh_apply_graph` runtime and overlap results. Use returned IDs for repairs. For existing canvas checks, use `gh_get_canvas_errors`; inspect bounds when spacing remains uncertain.
