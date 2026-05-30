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

## Input construction tips

- Point/vector on panel: `{0,0,0}`
- Domain on panel: `<start> to <end>` e.g. `-5 to 5`, `0 to 1`
- IsoTrim `D`: use Divide Domain² output (surface as domain)
- Graph Mapper: normalized 0–1 only; user sets mapper manually
- Color/material on panel: rgba `255,105,180` or `255,105,180 (152)`
