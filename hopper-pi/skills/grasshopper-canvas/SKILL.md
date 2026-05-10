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
        2. Read response: find "Circle" → id = "Circle", instanceGuid = "abc-123"
        3. gh_delete_component(targetId: "abc-123")
```

### Rule 2: After edits, re-fetch to confirm state

The backend processes commands asynchronously. After making changes, call `gh_get_canvas` again to verify the result before reporting back to the user.

---

## Tool Reference — Quick Decision Guide

### Need to SEE what's on canvas?

| You want to... | Call this |
|---------------|-----------|
| See everything (components, wires, values) | `gh_get_canvas` |
| Find a component type to add (get its typeGuid) | `gh_list_components` |
| Find specific kinds of components | `gh_list_components(queries: ["circle", "slider"])` |

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

When you call `gh_get_canvas`, every component shows its `[id]`, `typeGuid`, `instanceGuid`, and every port shows its `instanceGuid`:

```
=== COMPONENTS ===

[Cir] Cir (Circle)
  INSTANCE_GUID=aaaa-bbbb-cccc-dddd-1111-2222-3333-4444  <-- use this for ALL tool calls
  TYPE_GUID=eeee-ffff-0000-1111-2222-3333-4444-5555      <-- component type definition
  OUTPUTS (fromPort values):
    PORT_INSTANCE_GUID=6666-7777-8888-9999-aaaa-bbbb-cccc-dddd  (C)  <-- for wire tool fromPort
  INPUTS (toPort values):
    PORT_INSTANCE_GUID=1234-5678-abcd-ef01-2345-6789-abcd-ef0  (R)  <-- for wire tool toPort
```

**Identifier system:**

1. **`[id]`** = readable label like `Cir`, `Number Slider`. This is your **reasoning handle** — use it to identify which component you're working with, track state across steps, and decide logic. Every tool call resolves through this label.

2. **`INSTANCE_GUID`** = hex string on the `INSTANCE_GUID=` line. This is the **real identifier** the backend uses. **ALL tools** that reference an existing component or port must use this value: `gh_delete_component`, `gh_move_component`, `gh_rename_component`, `gh_connect_wire`, `gh_disconnect_wire`, `gh_set_locked`, `gh_set_hidden`, `gh_set_slider_value`, `gh_set_panel_text`.

3. **`TYPE_GUID`** = hex string on the `TYPE_GUID=` line. This identifies the component *type* definition. Use this when calling `gh_add_component(componentType: ...)` to add a new component of that type.

4. **`PORT_INSTANCE_GUID`** = hex string on each port's `PORT_INSTANCE_GUID=` line. Use these as **`fromPort` / `toPort`** for wire tools (`gh_connect_wire`, `gh_disconnect_wire`).

> **ALL tool calls referencing existing components/ports MUST use instanceGuid strings.** Never pass `[id]` or nicknames to any tool. Use `[id]` only for your own reasoning about which component is which.

---

## Worked Examples

### Example 1: Add a component and connect it

**User:** "Add a circle and connect a number slider to its radius"

```python
# Step 1: Get current canvas state
gh_get_canvas()
# → Returns: { components: { "Number Slider": {...} }, ... }

# Step 2: Look up the Circle component GUID
gh_list_components(queries: ["circle"])
# → Returns: { results: [{ queryKeyword: "circle", result: [{ name: "Circle", typeGuid: "c155f249-...", category: "Curve", ... }] }] }

# Step 3: Add the Circle at position (0, 50)
gh_add_component(
  componentType: "c155f249-...",   # the typeGuid from step 2
  x: 0,
  y: 50
)

# Step 4: Re-fetch to get the new Circle's ports
gh_get_canvas()
# → Now "Circle" exists with inputs.radius.instanceGuid = "xxxx-..."

# Step 5: Connect slider output to Circle radius input
gh_connect_wire(
  fromComponent: "<slider instanceGuid>",    # from Number Slider's INSTANCE_GUID= line
  fromPort: "<slider output portInstanceGuid>",   # from Number Slider's OUTPUTS PORT_INSTANCE_GUID= line
  toComponent: "<circle instanceGuid>",     # from Circle's INSTANCE_GUID= line
  toPort: "<circle radius portInstanceGuid>"       # from Circle's INPUTS PORT_INSTANCE_GUID= line
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
# → Find: "Number Slider" [id], instanceGuid = "abc-123"
# → Find: "Panel" [id], instanceGuid = "def-456"

# Step 2: Set slider value
gh_set_slider_value(
  targetId: "abc-123",
  value: 25
)

# Step 3: Hide panel
gh_set_hidden(
  targetId: "def-456",
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
# → Found: [id] = "Panel_3", instanceGuid = "xyz-789", value.text = "result"

# Step 3: Delete it
gh_delete_component(targetId: "xyz-789")

# Step 4: Confirm
gh_get_canvas()
```

### Example 4: Build a small definition from scratch

**User:** "Make a circle with radius 10 at origin"

```python
# Step 1: Check what's on canvas
gh_get_canvas()

# Step 2: Look up component GUIDs we need (batched in one call)
gh_list_components(queries: ["circle", "slider"])
# → Returns results for "circle" and "slider" in one request

# Step 3: Add slider for radius
gh_add_component(componentType: "<slider-guid>", x: -100, y: 0)

# Step 4: Re-fetch (new component now has an ID)
gh_get_canvas()
# → "Number Slider" added

# Step 5: Set slider to 10
gh_set_slider_value(targetId: "<slider-instanceGuid>", value: 10)

# Step 6: Add circle
gh_add_component(componentType: "<circle-typeGuid>", x: 0, y: 0)

# Step 7: Re-fetch again (need Circle's port instanceGuids)
gh_get_canvas()
# → "Circle" added, now has input port instanceGuids

# Step 8: Connect slider → circle radius
gh_connect_wire(
  fromComponent: "<slider instanceGuid>",
  fromPort: "<slider output portInstanceGuid>",
  toComponent: "<circle instanceGuid>",
  toPort: "<circle radius portInstanceGuid>"
)

# Step 9: Final verification
gh_get_canvas()
```

---

## Port Resolution Cheat Sheet

After calling `gh_get_canvas`, here's how to find what you need for each operation:

| Operation | What you need | Where to find it in `gh_get_canvas` result |
|-----------|--------------|---------------------------------------------|
| `gh_delete_component` | `targetId` | `component.instanceGuid` (hex string) |
| `gh_move_component` | `targetId` | `component.instanceGuid` |
| `gh_rename_component` | `targetId` | `component.instanceGuid` |
| `gh_set_locked` | `targetId` | `component.instanceGuid` |
| `gh_set_hidden` | `targetId` | `component.instanceGuid` |
| `gh_set_slider_value` | `targetId` | `component.instanceGuid` (of a slider-type component) |
| `gh_set_panel_text` | `targetId` | `component.instanceGuid` (of a panel-type component) |
| `gh_add_component` | `componentType` | `component.typeGuid` from `gh_list_components`, or look up via filter |
| `gh_connect_wire` | `fromComponent`, `toComponent` | `component.instanceGuid` on each component (hex like `aaaa-bbbb-...`) |
| `gh_connect_wire` | `fromPort` | `outputPort.instanceGuid` from source component's OUTPUTS section (hex like `eeee-ffff-...`) |
| `gh_connect_wire` | `toPort` | `inputPort.instanceGuid` from target component's INPUTS section (hex like `6666-7777-...`) |
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

### Wire connect fails (wrong instanceGuid)

- Port instanceGuids are case-sensitive and must be exact
- Re-read them fresh from the most recent `gh_get_canvas` response
- Make sure you're using an **output port instanceGuid** for `fromPort` and an **input port instanceGuid** for `toPort`
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

2. **Batch component searches:** Pass multiple queries in one `gh_list_components(queries: ["circle", "slider"])` call. The registry is fetched once and filtered locally for each query (cached 60s).

3. **No caching — always fetch fresh:** Every `gh_get_canvas` call hits the live backend. There is no cache. If you think the canvas may have changed (user made manual edits, or you just ran edit tools), call `gh_get_canvas` again to get the latest state.

4. **Name things for the user:** When adding components, use descriptive nicknames via `nickName` parameter so the canvas is human-readable. When the user asks "what's on the canvas?", report using nicknames and types.

5. **Check component state before modifying:** Before calling `gh_set_slider_value`, confirm the target is actually a slider (check `component.value.type === "slider"`). Before `gh_set_panel_text`, confirm it's a panel. Always pass `component.instanceGuid` as `targetId`, never `[id]`. This prevents silent no-op errors.

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
