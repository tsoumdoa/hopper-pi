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
| `singleString` | One string; line breaks stay inside it | Domains (`0 to 1`), paths, labels, any single text value |
| `oneItemPerLine` | One list item **per line** | Several numbers, points, or pattern tokens — one value per row |

Examples (same panel text, different mode):

```
1
2
3
```

- `oneItemPerLine` → list `{1, 2, 3}`
- `singleString` → one string `"1\n2\n3"`

## Python script tree/list ports

When a Python script port uses **tree** access, convert at the boundary with `ghpythonlib.treehelpers`:

- **Tree input** → `th.tree_to_list(x)` before list-style Python work
- **Tree output** → `a = th.list_to_tree(result)` before assigning to the output

List-access ports use plain Python lists; item-access ports use single values. Full recipes and anti-patterns → [python-boilerplate.md](./python-boilerplate.md#list-vs-tree-access-types). If you see `Data conversion failed from Goo to …` on the canvas, run `gh_get_canvas_errors` for an inline treehelpers hint.

## Input construction tips

- Point/vector on panel: `{0,0,0}`
- Domain on panel: `<start> to <end>` e.g. `-5 to 5`, `0 to 1`
- IsoTrim `D`: use Divide Domain² output (surface as domain)
- Graph Mapper: normalized 0–1 only; user sets mapper manually
- Color/material on panel: rgba `255,105,180` or `255,105,180 (152)`
