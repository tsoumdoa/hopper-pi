---
name: grasshopper-canvas
description: Inspect and edit Grasshopper canvas components, wires, and values via ZeroMQ to Rhino backend. Use when the user asks about Grasshopper, Rhino, GH definitions, adding/connecting/moving/deleting components, setting sliders or panels, or any visual programming task on the Grasshopper canvas.
---

# Grasshopper Canvas Tools

You have **14 tools** for interacting with a Grasshopper canvas running inside Rhino via ZeroMQ. This skill teaches you how to use them efficiently and correctly.

> **CRITICAL:** The backend (Rhino with rhino-zmq-poc plugin) must be running. If you get connection errors, tell the user to open Rhino/Grasshopper with the plugin loaded.

---

## Mandatory Workflow Pattern

### Rule 1: Always fetch canvas before editing

The canvas data is cached locally after `gh_get_canvas`. Every edit tool needs component IDs and port GUIDs that come from this cache.

```
WRONG:  User says "delete the circle" → you call gh_delete_component immediately
        → you don't have the ID → you guess → it fails

CORRECT: User says "delete the circle"
        1. gh_get_canvas()          ← always first
        2. Read response: find "Circle" → id = "Circle", guid = "abc-123"
        3. gh_delete_component(targetId: "Circle")
```

### Rule 2: After edits, re-fetch to confirm state

The backend processes commands asynchronously. After making changes, call `gh_get_canvas` again to verify the result before reporting back to the user.

---

## Tool Reference — Quick Decision Guide

### Need to SEE what's on canvas?

| You want to... | Call this |
|---------------|-----------|
| See everything (components, wires, values) | `gh_get_canvas` |
| Find a component type to add (get its GUID) | `gh_list_components` |
| Find a specific kind of component | `gh_list_components(filter: "circle")` |

### Need to CHANGE something?

| You want to... | Call this |
|---------------|-----------|
| Add a new component | `gh_add_component` |
| Remove a component | `gh_delete_component` |
| Connect two components with a wire | `gh_connect_wire` |
| Disconnect a wire | `gh_disconnect_wire` |
| Move a component | `gh_move_component` |
| Rename a component | `gh_rename_component` |
| Lock/unlock a component | `gh_set_locked` |
| Show/hide a component | `gh_set_hidden` |
| Group components together | `gh_add_group` |
| Remove from a group | `gh_remove_from_group` |
| Change a slider value | `gh_set_slider_value` |
| Change panel text | `gh_set_panel_text` |

---

## How Component IDs and Port GUIDs Work

This is the most important thing to understand.

### Component IDs and Port GUIDs

When you call `gh_get_canvas`, every component shows its instance GUID and every port shows its GUID:

```
=== COMPONENTS ===

[Cir] Cir (Circle)
  COMPONENT_GUID=aaaa-bbbb-cccc-dddd-1111-2222-3333-4444  <-- for wire tool fromComponent/toComponent
  OUTPUTS (fromPort values):
    PORT_GUID=eeee-ffff-0000-1111-2222-3333-4444-5555  (C)  <-- for wire tool fromPort
  INPUTS (toPort values):
    PORT_GUID=6666-7777-8888-9999-aaaa-bbbb-cccc-dddd  (R)  <-- for wire tool toPort
```

**Two kinds of identifiers:**

1. **`[id]`** = readable label like `Cir`, `Number Slider`. Use this as `targetId` for **non-wire tools**: `gh_delete_component`, `gh_move_component`, `gh_rename_component`, `gh_set_locked`, `gh_set_hidden`, `gh_set_slider_value`, `gh_set_panel_text`.

2. **`COMPONENT_GUID`** = hex string on the `COMPONENT_GUID=` line. Use this as **`fromComponent` / `toComponent`** for **wire tools only** (`gh_connect_wire`, `gh_disconnect_wire`).

3. **`PORT_GUID`** = hex string on each `PORT_GUID=` line. Use this as **`fromPort` / `toPort`** for **wire tools only**.

> **Wire tools require ALL 4 parameters to be GUID strings.** Never pass `[id]` or nicknames to a wire tool.

---

## Worked Examples

### Example 1: Add a component and connect it

**User:** "Add a circle and connect a number slider to its radius"

```python
# Step 1: Get current canvas state
gh_get_canvas()
# → Returns: { components: { "Number Slider": {...} }, ... }

# Step 2: Look up the Circle component GUID
gh_list_components(filter: "circle")
# → Returns: { components: [{ name: "Circle", guid: "c155f249-...", category: "Curve", ... }] }

# Step 3: Add the Circle at position (0, 50)
gh_add_component(
  componentType: "c155f249-...",   # the GUID from step 2
  x: 0,
  y: 50
)

# Step 4: Re-fetch to get the new Circle's ports
gh_get_canvas()
# → Now "Circle" exists with inputs.radius.guid = "xxxx-..."

# Step 5: Connect slider output to Circle radius input
gh_connect_wire(
  fromComponent: "<slider COMPONENT_GUID>",    # from Number Slider's COMPONENT_GUID= line
  fromPort: "<slider output PORT_GUID>",   # from Number Slider's OUTPUTS PORT_GUID= line
  toComponent: "<circle COMPONENT_GUID>",     # from Circle's COMPONENT_GUID= line
  toPort: "<circle radius PORT_GUID>"       # from Circle's INPUTS PORT_GUID= line
)

# Step 6: Confirm
gh_get_canvas()
# → Verify wire appears in wire list
```

### Example 2: Modify existing components

**User:** "Set the slider to 25 and hide the panel"

```python
# Step 1: Fetch canvas
gh_get_canvas()
# → Find: "Number Slider" (id), "Panel" (id)

# Step 2: Set slider value
gh_set_slider_value(
  targetId: "Number Slider",
  value: 25
)

# Step 3: Hide panel
gh_set_hidden(
  targetId: "Panel",
  hidden: true
)

# Step 4: Confirm both changes
gh_get_canvas()
```

### Example 3: Search for a component by partial name

**User:** "Delete the panel that shows 'result'"

```python
# Step 1: Fetch canvas
gh_get_canvas()

# Step 2: Scan components for a Panel with matching text
# (The gh_get_canvas response includes all component details including
#  panel text in component.value.text for type="panel")
# → Found: id = "Panel_3", value.text = "result"

# Step 3: Delete it
gh_delete_component(targetId: "Panel_3")

# Step 4: Confirm
gh_get_canvas()
```

### Example 4: Build a small definition from scratch

**User:** "Make a circle with radius 10 at origin"

```python
# Step 1: Check what's on canvas
gh_get_canvas()

# Step 2: Look up component GUIDs we need
gh_list_components(filter: "circle")
# → Circle guid = "c155f249-..."
gh_list_components(filter: "slider")
# → Number Slider guid = "..."

# Step 3: Add slider for radius
gh_add_component(componentType: "<slider-guid>", x: -100, y: 0)

# Step 4: Re-fetch (new component now has an ID)
gh_get_canvas()
# → "Number Slider" added

# Step 5: Set slider to 10
gh_set_slider_value(targetId: "Number Slider", value: 10)

# Step 6: Add circle
gh_add_component(componentType: "<circle-guid>", x: 0, y: 0)

# Step 7: Re-fetch again (need Circle's port GUIDs)
gh_get_canvas()
# → "Circle" added, now has input port GUIDs

# Step 8: Connect slider → circle radius
gh_connect_wire(
  fromComponent: "<slider COMPONENT_GUID>",
  fromPort: "<slider output PORT_GUID>",
  toComponent: "<circle COMPONENT_GUID>",
  toPort: "<circle radius PORT_GUID>"
)

# Step 9: Final verification
gh_get_canvas()
```

---

## Port Resolution Cheat Sheet

After calling `gh_get_canvas`, here's how to find what you need for each operation:

| Operation | What you need | Where to find it in `gh_get_canvas` result |
|-----------|--------------|---------------------------------------------|
| `gh_delete_component` | `targetId` | `component.id` (e.g. `"Circle"`, `"Panel_2"`) |
| `gh_move_component` | `targetId` | `component.id` |
| `gh_rename_component` | `targetId` | `component.id` |
| `gh_set_locked` | `targetId` | `component.id` |
| `gh_set_hidden` | `targetId` | `component.id` |
| `gh_set_slider_value` | `targetId` | `component.id` (of a slider-type component) |
| `gh_set_panel_text` | `targetId` | `component.id` (of a panel-type component) |
| `gh_connect_wire` | `fromComponent`, `toComponent` | `COMPONENT_GUID=` line on each component's header (hex like `aaaa-bbbb-...`) |
| `gh_connect_wire` | `fromPort` | `PORT_GUID=` value from source component's OUTPUTS section (hex like `eeee-ffff-...`) |
| `gh_connect_wire` | `toPort` | `PORT_GUID=` value from target component's INPUTS section (hex like `6666-7777-...`) |
| `gh_disconnect_wire` | same as connect | same fields |

### Common port names to know

Grasshopper uses conventional port nicknames. Here are the most common ones:

| Component Type | Typical Output Ports | Typical Input Ports |
|----------------|--------------------|--------------------|
| Number Slider | `Value` | — |
| Panel | — | `—` (no data inputs) |
| Circle | `C` (circle) | `Plane`, `Radius` |
| Line | `L` (line) | `A`, `B` (endpoints) |
| Point | `P` (point) | `{x,y,z}` coords |
| Divide Curve | `t`, `P`, `N` | `C` (curve), `N` (count) |
| Brep Components | `V`, `E`, `F`, `C` | `B` (brep) |
| Merge | `R` (result) | Multiple inputs named `0`, `1`, `2`... |
| Expression | `R` (result) | Variable names like `x`, `y`, `i` |
| Text Split | `P` (parts) | `T` (text), `C` (separator) |

> **Tip:** Always read the actual port nicks from the `gh_get_canvas` response rather than guessing — custom components or plugins may use non-standard names.

---

## Error Recovery

### "Cannot connect to Grasshopper"

- The Rhino/ZMQ backend is not running or not reachable
- Tell user to: **Open Rhino, load the rhino-zmq-poc plugin, ensure Grasshopper is open**
- Check that environment variables match (default ports: PUB=5555, PUSH=5556, REQ=5557)

### Component ID not found after add

- After `gh_add_component`, the new component may take a moment to appear
- **Always call `gh_get_canvas` between adding a component and trying to reference it**
- If still missing, wait briefly and call `gh_get_canvas` again

### Wire connect fails (wrong port GUID)

- Port GUIDs are case-sensitive and must be exact
- Re-read them fresh from the most recent `gh_get_canvas` response
- Make sure you're using an **output port GUID** for `fromPort` and an **input port GUID** for `toPort`
- Mixing these up is the most common cause of wire failures

### Canvas seems out of date

- Every `gh_get_canvas` fetches live data — there is no cache. But if the result doesn't match what you expect, just call `gh_get_canvas` again.

### Command sent but no ACK received

- The command was published but the backend didn't acknowledge within the timeout
- The action may still have executed — call `gh_get_canvas` to check
- If timeout is too short, the user can increase `GH_ACK_TIMEOUT_MS` env var

---

## Efficiency Tips

1. **Batch your reads, chain your writes:** One `gh_get_canvas` gives you everything. Plan all your edits based on one snapshot, then execute them, then verify once at the end.

2. **Use `gh_list_components` with filters:** Don't fetch the full 500+ component list if you only need circles. Use `filter: "curve"` or `filter: "math"` to narrow down.

3. **No caching — always fetch fresh:** Every `gh_get_canvas` call hits the live backend. There is no cache. If you think the canvas may have changed (user made manual edits, or you just ran edit tools), call `gh_get_canvas` again to get the latest state.

4. **Name things for the user:** When adding components, use descriptive nicknames via `nickName` parameter so the canvas is human-readable. When the user asks "what's on the canvas?", report using nicknames and types.

5. **Check component state before modifying:** Before calling `gh_set_slider_value`, confirm the target is actually a slider (check `component.value.type === "slider"`). Before `gh_set_panel_text`, confirm it's a panel. This prevents silent no-op errors.

6. **Wire order doesn't matter mathematically but does for clarity:** Connect data-flow left-to-right (sources on the right/top, consumers on the left/bottom matches standard Grasshopper layout conventions).

---

## When to Suggest This Skill to the User

Activate this workflow when you hear keywords like:

- "Grasshopper", "GH", "canvas", "definition"
- "Rhino", "visual programming"
- "add component", "connect", "wire", "slider", "panel"
- "move", "rename", "group", "hide", "lock"
- "circle", "curve", "surface", "brep", "mesh" (in a design/geometry context)
- "build a definition", "set up a patch"
