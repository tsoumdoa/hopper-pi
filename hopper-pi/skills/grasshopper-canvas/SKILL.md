---
name: grasshopper-canvas
description: Inspect and edit Grasshopper canvas components, wires, and values via ZeroMQ to Rhino backend. Use when the user asks about Grasshopper, Rhino, GH definitions, adding/connecting/moving/deleting components, setting sliders or panels, generating parametric geometry, architectural forms, towers, facades, pavilions, or any visual programming task on the Grasshopper canvas.
---

# Grasshopper Canvas Tools

**14 tools** for interacting with a Grasshopper canvas via ZeroMQ. Backend (Rhino + rhino-zmq-poc plugin) must be running.

## Workflow Rules

These rules apply to **every** canvas interaction — from hiding a component to building a complex parametric tower.

1. **`gh_get_canvas` first** — you need instanceGuids from the response before any edit
2. **Re-fetch after edits** to confirm state (backend is async)
3. **All edit tools accept `items: [...]` array** — batch multiple operations in one call, executed sequentially
4. **Build in batches of ~10 nodes**, re-fetching `gh_get_canvas()` between batches to get new port GUIDs
5. **Layout left-to-right** following data flow; space components ~100-150px apart horizontally, ~50-80px vertically; group related components

```
example:   gh_delete_component(items: [{ targetId: "a" }, { targetId: "b" }, { targetId: "c" }])
```

## Tool Reference

### Query

| Tool | Params | Purpose |
|------|--------|---------|
| `gh_get_canvas` | _(none)_ | Full canvas snapshot — always call first |
| `gh_list_components` | `queries?: string[]` | Find component type GUIDs; supports batch queries |

### Edit (all accept `items: [...]`)

| Tool | Item params | Purpose |
|------|------------|---------|
| `gh_add_component` | `componentType`, `x`, `y`, `nickName?` | Add component(s) |
| `gh_delete_component` | `targetId` | Delete by ID |
| `gh_connect_wire` | `fromComponent`, `fromPort`, `toComponent`, `toPort` | Connect ports |
| `gh_disconnect_wire` | `fromComponent`, `fromPort`, `toComponent`, `toPort` | Disconnect |
| `gh_move_component` | `targetId`, `x`, `y` | Reposition |
| `gh_rename_component` | `targetId`, `nickName` | Rename |
| `gh_set_locked` | `targetId`, `locked` | Lock/unlock |
| `gh_set_hidden` | `targetId`, `hidden` | Show/hide |
| `gh_add_group` | `componentIds` (comma-str), `groupName` | Group components |
| `gh_remove_from_group` | `componentIds` (comma-str), `groupName` | Ungroup |
| `gh_set_slider_value` | `targetId`, `value` | Set slider |
| `gh_set_panel_text` | `targetId`, `text` | Set panel text |

## Identifier System

From `gh_get_canvas` output:

| Identifier | Source | Used For |
|-----------|--------|----------|
| `[id]` | e.g. `Cir`, `Number Slider` | Your reasoning only — never pass to tools |
| `INSTANCE_GUID` | hex on `INSTANCE_GUID=` line | All tool calls referencing existing components/ports |
| `TYPE_GUID` | hex on `TYPE_GUID=` line | `gh_add_component(componentType:)` only |
| `PORT_INSTANCE_GUID` | hex per port in OUTPUTS/INPUTS sections | Wire tool `fromPort` / `toPort` |

**Rule:** Always use instanceGuid strings. Never pass `[id]` or nicknames.

## Port Resolution Cheat Sheet

| Operation | Field needed | Where in `gh_get_canvas` result |
|-----------|-------------|----------------------------------|
| delete/move/rename/lock/hide/slider/panel | `targetId` | `component.instanceGuid` |
| add | `componentType` | `gh_list_components` → `typeGuid` |
| connect/disconnect wire | `fromComponent`, `toComponent` | `component.instanceGuid` |
| connect/disconnect wire | `fromPort` | source `outputPort.instanceGuid` |
| connect/disconnect wire | `toPort` | target `inputPort.instanceGuid` |

## Worked Examples

### Add & connect
```text
gh_get_canvas()
gh_list_components(queries: ["circle"])
# → typeGuid = "c155f249-..."

gh_add_component(items: [{ componentType: "c155f249-...", x: 0, y: 50 }])
gh_get_canvas()  # new component has port GUIDs now

gh_connect_wire(items: [{
  fromComponent: "<slider INSTANCE_GUID>",
  fromPort: "<slider OUTPUT PORT_INSTANCE_GUID>",
  toComponent: "<circle INSTANCE_GUID>",
  toPort: "<circle INPUT PORT_INSTANCE_GUID>"
}])
gh_get_canvas()  # verify
```

### Modify existing (batch)
```text
gh_get_canvas()

gh_set_slider_value(items: [{ targetId: "<slider-guid>", value: 25 }])
gh_set_hidden(items: [{ targetId: "<panel-guid>", hidden: true }])

gh_get_canvas()  # confirm both
```

### Search & delete
```text
gh_get_canvas()
# scan for Panel with text "result" → instanceGuid = "xyz-789"

gh_delete_component(items: [{ targetId: "xyz-789" }])
gh_get_canvas()
```

### Build from scratch
```text
gh_get_canvas()
gh_list_components(queries: ["circle", "slider"])

gh_add_component(items: [{ componentType: "<slider-guid>", x: -100, y: 0 }])
gh_get_canvas()  # get slider's instanceGuid

gh_set_slider_value(items: [{ targetId: "<slider-guid>", value: 10 }])

gh_add_component(items: [{ componentType: "<circle-guid>", x: 0, y: 0 }])
gh_get_canvas()  # get circle's port GUIDs

gh_connect_wire(items: [{
  fromComponent: "<slider guid>", fromPort: "<output port>",
  toComponent: "<circle guid>", toPort: "<radius input port>"
}])
gh_get_canvas()
```

---

## Geometry Generation Patterns

Use these recipes when the user asks to create, build, or generate geometry — architectural forms, parametric structures, towers, facades, pavilions, or showcase pieces.

### Pattern: Twisted Tower

A classic parametric tower using stacked twisted circles lofted into volume.

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

**Tower wiring reference** (specific to this pattern):

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

### Pattern: Reciprocal Frame Pavilion

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

### Creating Your Own Geometry Patterns

When generating geometry not covered above, follow this general strategy:

1. **Identify parameters** — what should the user control? (sliders for count, size, height, etc.)
2. **Lay out data flow left-to-right**: inputs (sliders/panels) → logic (series/expression/math) → geometry (primitives) → transform (move/rotate/scale) → output (loft/extrude/pipe)
3. **Work in batches**: add ~10 components, `gh_get_canvas`, wire that layer, repeat
4. **Use descriptive nickNames** — helps you track components in `gh_get_canvas` output
5. **Group logical sections** with `gh_add_group` after verification (Inputs, Logic, Geometry, Output)

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Tool hangs / no response | Backend not running | Verify Rhino + rhino-zmq-poc plugin is open |
| `gh_connect_wire` fails | Stale GUIDs | Re-run `gh_get_canvas` to get fresh GUIDs |
| Component not visible after add | Added off-canvas | Check coordinates; use `gh_move_component` to reposition |
| Slider value rejected | Outside min/max range | Use `gh_get_canvas` to read slider's min/max first |
| Wire connection does nothing | Wrong port direction | Ensure `fromPort` is an OUTPUT and `toPort` is an INPUT |
