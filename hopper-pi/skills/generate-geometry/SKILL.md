---
name: generate-geometry
description: Generate architectural parametric geometry on the Grasshopper canvas. Use when the user asks to create, build, or generate interesting geometry, architectural forms, parametric structures, towers, facades, pavilions, or any showcase piece on the Grasshopper canvas.
---

# Parametric Geometry Generation

Generate impressive geometry on the Grasshopper canvas using batch edit tools.

## Rules

1. `gh_get_canvas` first — know what's there
2. `gh_list_components(queries: [...])` to find GUIDs — never guess
3. After each `gh_add_component` batch → `gh_get_canvas` for port GUIDs
4. **All edits use `items: [...]`** — batch consecutive operations
5. Build in batches of ~10 nodes, re-fetch between


### Execution

```text
# 1. Discover GUIDs
gh_get_canvas()
gh_list_components(queries: ["slider", "series", "expression",
                              "circle", "move", "rotate", "loft",
                              "divide curve", "graph mapper", "scale", "extrude"])

# 2. Add input sliders (batched)
gh_add_component(items: [
  { componentType: "<slider-guid>", x: -400, y: 200, nickName: "Base Radius" },
  { componentType: "<slider-guid>", x: -400, y: 100, nickName: "Floors" },
  { componentType: "<slider-guid>", x: -400, y: 0, nickName: "Twist" },
  { componentType: "<slider-guid>", x: -400, y: -100, nickName: "Floor Height" },
])
gh_get_canvas()  # get slider instanceGuids + port GUIDs

# 3. Set slider values (batched)
gh_set_slider_value(items: [
  { targetId: "<radius-guid>", value: 15 },
  { targetId: "<floors-guid>", value: 30 },
  { targetId: "<twist-guid>", value: 90 },
  { targetId: "<height-guid>", value: 4 },
])

# 4. Add generation components (batched)
gh_add_component(items: [
  { componentType: "<series-guid>", x: -150, y: 100, nickName: "Floor Index" },
  { componentType: "<expression-guid>", x: -50, y: 100, nickName: "Z Position" },
  { componentType: "<expression-guid>", x: -50, y: 0, nickName: "Rotation" },
  { componentType: "<circle-guid>", x: 50, y: 50, nickName: "Floor Circle" },
])
gh_get_canvas()  # get new component GUIDs

# 5. Add transform + volume (batched)
gh_add_component(items: [
  { componentType: "<move-guid>", x: 150, y: 100, nickName: "Move Up" },
  { componentType: "<rotate-guid>", x: 250, y: 50, nickName: "Twist" },
  { componentType: "<loft-guid>", x: 350, y: 50, nickName: "Tower Loft" },
])
gh_get_canvas()

# 6. Wire everything (batched per tool)
gh_connect_wire(items: [
  # Floors → Series N
  { fromComponent: "<floors>", fromPort: "<output>", toComponent: "<series>", toPort: "<N>" },
  # Series → Z Expression (i variable)
  { fromComponent: "<series>", fromPort: "<range>", toComponent: "<z-expr>", toPort: "<x>" },
  # Floor Height → Z Expression (h variable)
  { fromComponent: "<height>", fromPort: "<output>", toComponent: "<z-expr>", toPort: "<y>" },
  # ... continue all connections
])

# 7. Verify
gh_get_canvas()
```

### Wiring Reference

| From | To | Purpose |
|------|----|---------|
| Floors (slider) | Series N | Floor count |
| Series Range | Expression Z (x) | Index variable |
| Floor Height | Expression Z (y) | Height multiplier |
| Expression Z | Move Up (vector) | Z offset |
| Floors | Expression Rotation (n) | Total count |
| Series Range | Expression Rotation (i) | Index |
| Twist | Expression Rotation (t) | Total twist angle |
| Expression Rotation | Rotate (angle) | Per-floor rotation |
| Base Radius | Circle (radius) | Plate size |
| Circle | Move Up (geometry) | Stack circles |
| Moved circles | Rotate (geometry) | Twist plates |
| Rotated circles | Loft (curves) | Tower volume |

## Example: Reciprocal Frame Pavilion

Interlocking beam canopy — simpler but visually striking.

```text
gh_list_components(queries: ["slider", "point", "polar array", "line tt", "pipe"])

gh_add_component(items: [
  { componentType: "<slider-guid>", x: -200, y: 100, nickName: "Beam Count" },
  { componentType: "<slider-guid>", x: -200, y: 0, nickName: "Inner Radius" },
  { componentType: "<slider-guid>", x: -200, y: -100, nickName: "Outer Radius" },
  { componentType: "<slider-guid>", x: -200, y: -200, nickName: "Beam Height" },
])
gh_get_canvas()

gh_set_slider_value(items: [
  { targetId: "<count-guid>", value: 12 },
  { targetId: "<inner-guid>", value: 8 },
  { targetId: "<outer-guid>", value: 20 },
  { targetId: "<height-guid>", value: 2 },
])

gh_add_component(items: [
  { componentType: "<point-guid>", x: 0, y: 0, nickName: "Center" },
  { componentType: "<polar-guid>", x: 150, y: 50, nickName: "Polar Array" },
  { componentType: "<line-guid>", x: 300, y: 50, nickName: "Beams" },
  { componentType: "<pipe-guid>", x: 450, y: 50, nickName: "Pipe Beams" },
])
gh_get_canvas()
# wire: Center → Polar, Sliders → Polar params, Polar → Line → Pipe
gh_get_canvas()  # verify
```

