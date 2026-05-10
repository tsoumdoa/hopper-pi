---
name: grasshopper-canvas
description: Inspect and edit Grasshopper canvas components, wires, and values via ZeroMQ to Rhino backend. Use when the user asks about Grasshopper, Rhino, GH definitions, adding/connecting/moving/deleting components, setting sliders or panels, or any visual programming task on the Grasshopper canvas.
---

# Grasshopper Canvas Tools

**14 tools** for interacting with a Grasshopper canvas via ZeroMQ. Backend (Rhino + rhino-zmq-poc plugin) must be running.

## Workflow Rules

1. **Always `gh_get_canvas` before editing** — you need instanceGuids from the response
2. **Re-fetch after edits** to confirm state (backend is async)
3. **All edit tools accept `items: [...]` array** — batch multiple operations in one call, executed sequentially

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

## Port Resolution Cheat Sheet

| Operation | Field needed | Where in `gh_get_canvas` result |
|-----------|-------------|----------------------------------|
| delete/move/rename/lock/hide/slider/panel | `targetId` | `component.instanceGuid` |
| add | `componentType` | `gh_list_components` → `typeGuid` |
| connect/disconnect wire | `fromComponent`, `toComponent` | `component.instanceGuid` |
| connect/disconnect wire | `fromPort` | source `outputPort.instanceGuid` |
| connect/disconnect wire | `toPort` | target `inputPort.instanceGuid` |

