# Data Type Guide — Casting, Construction & Tips

> **When to use:** Mismatched parameter types, constructing panel inputs, or type conversions.

## Safe type casts

Lightweight type checks via parameter components:

- line ↔ polyline
- point ↔ plane
- closed polyline ↔ surface
- rectangle ↔ 2D domain
- planar surface ↔ 2D domain
- vector ↔ line
- color ↔ material

Remember: a line is two points; a plane needs origin + orientation (not three arbitrary points).

## Panel `textOutput` (required on create / setProperty)

| `textOutput` | Downstream data | Use when |
|--------------|-----------------|----------|
| `singleString` | One string; line breaks stay inside it (e.g. `"1\n2\n3"`) | Domains (`0 to 1`), paths, labels, any single text value |
| `oneItemPerLine` | One list item **per line** (e.g. `{1, 2, 3}`) | Several numbers, points, or pattern tokens — one value per row |

## Python tree/list ports

For tree-access inputs/outputs, conversion recipes, and anti-patterns, use [python-boilerplate.md](./python-boilerplate.md#list-vs-tree-access-types). On `Data conversion failed from Goo to …`, run `gh_get_canvas_errors` first for the targeted hint.

## Input construction tips

- Point/vector on panel: `{0,0,0}`
- Domain on panel: `<start> to <end>` e.g. `-5 to 5`, `0 to 1`
- IsoTrim `D`: use Divide Domain² output (surface as domain)
- Graph Mapper: normalized 0–1 only; user sets mapper manually
- Color/material on panel: rgba `255,105,180` or `255,105,180 (152)`
