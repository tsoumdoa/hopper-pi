---
name: grasshopper-canvas
description: Inspect and edit Grasshopper canvas components, wires, and values via ZeroMQ to Rhino backend. Use when the user asks about Grasshopper, Rhino, GH definitions, adding/connecting/moving/deleting components, setting sliders or panels, generating parametric geometry, architectural forms, towers, facades, pavilions, or any visual programming task on the Grasshopper canvas.
---

# Grasshopper Canvas Tools

**8 tools** for interacting with a Grasshopper canvas via ZeroMQ. Backend (Rhino + rhino-zmq-poc plugin) must be running.

---

## 1. Fundamental Scripting Rules

These are the **core conventions** that govern every Grasshopper definition you build. They ensure scripts are readable, maintainable, and logically sound.

### 1.1 Canvas Layout: Left-to-Right Data Flow

The script **must** read like a sentence — from left to right, top to bottom.

```
INPUTS  →  LOGIC / PROCESSING  →  GEOMETRY  →  OUTPUT
(left)                         (center)      (right)
```

**Rules:**
- **Data flows left → right.** Place input components (sliders, panels, value types) on the **left**. Place output geometry (bake, preview) on the **right**.
- **Place each processing step to the right of its source.** If component B takes output from component A, B must be positioned to the **right** of A.
- **Avoid wiring backward (right-to-left).** It breaks readability. If you need feedback loops, use explicit data dam or stream filter components and document them clearly.
- **Vertical spacing:** Group related operations in the same horizontal band (~50-80px apart vertically). Unrelated parallel data streams should be separated into distinct rows.
- **Horizontal spacing:** ~100-150px between components in a chain so wires and labels remain readable.

### 1.2 Input Parameter Placement

Input parameters have two roles — distinguish them clearly:

| Role | Position | Examples |
|------|----------|----------|
| **Global drivers** (control the overall model) | **Top-left corner** | Building height, floor count, total twist angle, master scale |
| **Local inputs** (feed directly into a specific component) | **Immediately left of the component they serve** | Circle radius slider placed right next to the Circle component |

**Rule:** When placing an input slider/panel/value, ask: *"Does this drive the whole model, or just one component?"*
- **Whole model** → top-left area, organized in a parameter block
- **One component** → place it directly to the left of that component, at the same vertical level as the input port it connects to

This means a reader can trace any wire from right to left and immediately see what value feeds it, without hunting across the canvas.

### 1.3 Coordinate System: Rhino / Grasshopper Conventions

Rhino uses a **right-handed coordinate system**. Always respect these axes:

| Axis | Direction | Typical Use in GH |
|------|-----------|-------------------|
| **X** | Horizontal (left-right) | Width, east-west positioning |
| **Y** | Horizontal (front-back) | Depth, north-south positioning |
| **Z** | Vertical (up-down) | **Elevation, height, floor levels** |

**Critical rules:**
- The **ground plane is X-Y**. Z is always elevation/height.
- When stacking elements (floors of a tower, layers of a facade), vary **Z**, not Y.
- `Circle`, `Rectangle`, `Plane` components operate in the **X-Y plane by default** (Z = 0). To elevate them, use a `Move` component with a Z-direction vector, or construct an offset plane.
- When creating points, `Point XYZ` takes (X, Y, Z) — don't accidentally pass elevation into Y.
- `Line SDL` (Start Direction Length): if direction is Unit Z (0,0,1), the line grows vertically — correct for columns/walls.
- **Never use Y as elevation.** This is the most common error. Z is always the vertical axis.

### 1.4 Data Type Discipline

Every port in Grasshopper expects a **specific data type**. Providing the wrong type will cause errors or silent failures. **Think carefully about what type each component needs before connecting.**

#### Core Data Types

| Type | What it looks like | Common sources |
|------|-------------------|----------------|
| `double` / `float` | Number (e.g., `12.5`) | Number Slider, Panel (numeric text), Math components |
| `int` | Integer (e.g., `7`) | Slider (integer rounding), Series N, List Item index |
| `string` | Text (e.g., `"Facade_A"`) | Panel, Text components |
| `Point3d` | `{x, y, z}` coordinate | Construct Point, Point XYZ, Evaluate Surface |
| `Vector3d` | Direction + magnitude | Unit X/Y/Z, Vector 2pt, Line direction |
| `Plane` | Origin + X/Y/Z frame | XY Plane, Plane Origin, Align Plane |
| `Curve` | Line, arc, circle, nurbs curve | Circle, Line, Polyline, Interpolate |
| `Surface` / `Brep` | Face, polysurface | Boundary Surfaces, Loft, Extrude |
| `Mesh` | Vertex-face grid | Mesh Brep, Mesh Plane |
| `Domain` | Interval `[min, max]` | Construct Domain, Bounds |
| `Colour` | RGBA value | Colour Swatch, Colour RGB |
| `boolean` | `true` / `false` | Toggle, Larger Than, Null Item |
| `List<T>` / `DataTree<T>` | Collection of items | Most components output lists when given multiple inputs |

#### Type Compatibility Rules

Before connecting output → input, verify compatibility:

1. **Number → Geometry parameter (Radius, Length, etc.)**: OK. Double/int feed directly into geometric magnitude ports.
2. **Number → Index port (i, N)**: Usually expects **integer**. If feeding a slider, ensure it outputs integers or round it first.
3. **Point → Point input**: OK. But **Point ≠ Vector**. A point is a position; a vector is a direction. Some ports accept either — but many don't. Use `Vector 2Pt` to convert points to vector when needed.
4. **Curve → Surface input**: NOT OK. You need `Boundary Surfaces`, `Loft`, `Extrude`, or `Planar Srf` to convert curves to surfaces first.
5. **Single item → List input**: Grasshopper usually auto-wraps (implicit "longest list" matching). But be aware: one curve fed into a component expecting a list of curves will produce one result, not an error.
6. **List → Single item input**: Takes the **first item only** (or fails depending on component). Use `List Item` to extract explicitly if needed.
7. **String → Number input**: NOT OK. Panel text is string type. Use `Expression` with formula or `Text Split` to convert.
8. **Domain → Number input**: NOT OK. A domain is an interval, not a scalar. Use `Deconstruct Domain` or `Interval Components` to extract start/end as numbers.

#### Common Type Mismatches to Avoid

| Wrong Connection | Why It Fails | Fix |
|-----------------|--------------|-----|
| Panel (text) → Radius | String ≠ number | Use Number Slider or Expression to parse |
| Point → Move direction | Point ≠ vector | Use Vector 2Pt or Unit Z/Y/X |
| Curve → Brep input | Curve ≠ surface/brep | Add Loft/Extrude/Boundary Surfaces |
| List of points → single Point input | May silently take first only | Use List Item or ensure intentional |
| Integer slider into expression expecting float | Usually works, but precision loss | Use floating-point slider |
| Domain into number parameter | Interval ≠ scalar | Deconstruct Domain first |

### 1.5 Component Naming & Organization

- **Always set `nickName`** on every added component. Default names ("Circle", "Expression") are useless when there are multiples.
- Use descriptive names: `"Floor Radius"`, `"Twist Angle"`, `"Z Elevation"`, not `"Slider 01"`, `"Expr 02"`.
- Name inputs after **what they represent**, not their data type: `"Building Height"` not `"Number Slider 1"`.
- Group related components with `gh_add_group` after verification:
  - `"Parameters"` — global driver sliders (top-left block)
  - `"Grid / Layout"` — point generation, division logic
  - `"Geometry"` — primitive creation (circles, lines, rectangles)
  - `"Transform"` — move, rotate, scale, mirror
  - `"Output"` — loft, extrude, bake, preview

---

## 2. Workflow Rules (Operational)

These rules apply to **every canvas interaction** — from hiding a component to building a complex parametric tower.

1. **`gh_get_canvas` first** — you need instanceGuids from the response before any edit
2. **Re-fetch after edits** to confirm state (backend is async)
3. **All edit tools accept `items: [...]` array** — batch multiple operations in one call, executed sequentially
4. **Build in batches of ~10 nodes**, re-fetching `gh_get_canvas()` between batches to get new port GUIDs
5. **Layout left-to-right** following data flow; space components ~100-150px apart horizontally, ~50-80px vertically; group related components

```
example:   gh_edit_components(items: [{ action: "delete", targetId: "a" }, { action: "delete", targetId: "b" }, { action: "delete", targetId: "c" }])
```

---

## 3. Tool Reference

### Query

| Tool | Params | Purpose |
|------|--------|---------|
| `gh_get_canvas` | _(none)_ | Full canvas snapshot — always call first |
| `gh_list_components` | `queries?: string[]`, `onlyName?: boolean` | Find component type GUIDs; defaults to name+id only, pass `onlyName: false` for full details (category, subcategory, description) |

### Edit (all accept `items: [...]`)

| Tool | Item params | Purpose |
|------|------------|---------|
| `gh_edit_components` | `action`, `targetId?`, `componentType?`, `x?`, `y?`, `nickName?`, `locked?`, `hidden?` | Add/delete/move/rename/lock/hide component(s) — action selects operation |
| `gh_edit_wire` | `action` ("connect"/"disconnect"), `fromComponent`, `fromPort`, `toComponent`, `toPort` | Connect or disconnect wires between ports |
| `gh_edit_group` | `operation`, `componentIds?`, `groupName?`, `color?`, `name?`, `border?` | Group operations (add/remove/delete/rename/color/style) |
| `gh_edit_slider` | `action`, `targetId?`, `x?`, `y?`, `nickName?`, `min?`, `max?`, `value?`, `digits?`, `interval?` | Create/edit/set slider — action selects operation |
| `gh_set_panel_text` | `targetId`, `text` | Set panel text |

---

## 4. Identifier System

From `gh_get_canvas` output:

| Identifier | Source | Used For |
|-----------|--------|----------|
| `[id]` | e.g. `Cir`, `Number Slider` | Your reasoning only — never pass to tools |
| `INSTANCE_GUID` | short GUID alias on `INSTANCE_GUID=` line | All tool calls referencing existing components/ports |
| `TYPE_GUID` | short GUID alias on `TYPE_GUID=` line | `gh_add_component(componentType:)` only |
| `PORT_INSTANCE_GUID` | short GUID alias per port in OUTPUTS/INPUTS sections | Wire tool `fromPort` / `toPort` |

**Rule:** Always use instanceGuid strings (short aliases are preferred and auto-resolved). Never pass `[id]` or nickNames.

## Port Resolution Cheat Sheet

| Operation | Field needed | Where in `gh_get_canvas` result |
|-----------|-------------|----------------------------------|
| delete/move/rename/lock/hide/slider/panel | `targetId` | `component.instanceGuid` |
| add (via `gh_edit_components` action="add") | `componentType` | `gh_list_components` → `typeGuid` |
| connect/disconnect wire (via `gh_edit_wire`) | `fromComponent`, `toComponent` | `component.instanceGuid` |
| connect/disconnect wire (via `gh_edit_wire`) | `fromPort` | source `outputPort.instanceGuid` |
| connect/disconnect wire (via `gh_edit_wire`) | `toPort` | target `inputPort.instanceGuid` |

---

## 5. Worked Examples

### Example 1: Simple Circle with Proper Layout

Demonstrates left-to-right flow, input placement next to consumer, and correct data types.

```text
# Goal: A circle at origin, radius controlled by slider, elevated in Z

gh_get_canvas()
gh_list_components(queries: ["circle", "move", "construct point", "unit z"])

# --- LAYER 1: INPUTS (left side) ---
# Global/local input: radius is specific to Circle → place right next to it
# Elevation is a positional parameter → also near the transform it drives
# Use createSlider to create AND configure in one call (no need for addComponent + separate setValue)

gh_edit_slider(items: [
  # Radius slider: placed left of where Circle will be (x=-200), same Y level
  { action: "createSlider", x: -200, y: 0, nickName: "Radius", min: 0, max: 50, value: 10, digits: 2, interval: 0.5 },
  # Height slider: placed left of where Move will be (x=100), same Y level
  { action: "createSlider", x: 0, y: 100, nickName: "Elevation Z", min: 0, max: 100, value: 20, digits: 1, interval: 1 },
])
gh_get_canvas()

# --- LAYER 2: GEOMETRY (center) ---

gh_edit_components(items: [
  # Circle: right of its radius slider
  { action: "add", componentType: "<circle-guid>", x: -50, y: 0, nickName: "Base Circle" },
])
gh_get_canvas()

# Wire: Radius slider (double) → Circle Radius port (expects double) ✓
gh_edit_wire(items: [{
  action: "connect",
  fromComponent: "<radius-slider-guid>",
  fromPort: "<radius-output-port>",
  toComponent: "<circle-guid>",
  toPort: "<radius-input-port>"
}])

# --- LAYER 3: TRANSFORM (right of geometry) ---

gh_edit_components(items: [
  # Unit Z vector for vertical move (Vector3d type)
  { action: "add", componentType: "<unitz-guid>", x: 50, y: 100, nickName: "Up Direction" },
  # Multiplication: Elevation (double) × Unit Z (vector) → Vector3d (scaled direction)
  { action: "add", componentType: "<multiply-guid>", x: 150, y: 100, nickName: "Move Vector" },
  # Move: takes geometry (Curve) + direction (Vector3d)
  { action: "add", componentType: "<move-guid>", x: 270, y: 50, nickName: "Elevate Circle" },
])
gh_get_canvas()

# Wire: Elevation slider → Multiply (A: double ✓)
#        Unit Z → Multiply (B: vector ✓)
#        Multiply (vector) → Move Geometry direction (vector ✓)
#        Circle (curve) → Move Geometry (curve ✓)

gh_connect_wire(items: [
  { fromComponent: "<elev-guid>", fromPort: "<output>", toComponent: "<multiply-guid>", toPort: "<A-input>" },
  { fromComponent: "<unitz-guid>", fromPort: "<output>", toComponent: "<multiply-guid>", toPort: "<B-input>" },
  { fromComponent: "<multiply-guid>", fromPort: "<output-vector>", toComponent: "<move-guid>", toPort: "<direction>" },
  { fromComponent: "<circle-guid>", fromPort: "<output-curve>", toComponent: "<move-guid>", toPort: "<geometry>" },
])

gh_get_canvas()  # verify complete left-to-right flow
```

**Layout visualization:**

```
[Radius Slider]──→[Circle]─────────────→
                                              [Elevate Circle]
[Elev Z Slider]→[Unit Z]→[Multiply]──→         (output)
```

### Example 2: Twisted Tower (Full Pattern)

A parametric tower using stacked twisted circles lofted into volume. Demonstrates all rules together.

```text
# 1. Discover GUIDs
gh_get_canvas()
gh_list_components(queries: ["series", "expression",
                              "circle", "move", "rotate", "loft",
                              "divide curve", "graph mapper", "scale",
                              "construct point", "unit z", "vector xyz"])

# === PARAMETER BLOCK (top-left: global drivers) ===
# Use createSlider to create AND configure in one call

gh_edit_slider(items: [
  { action: "createSlider", x: -450, y: 200, nickName: "Base Radius", min: 0, max: 50, value: 15, digits: 2, interval: 1 },
  { action: "createSlider", x: -450, y: 100, nickName: "Floors",     min: 1, max: 100, value: 30, digits: 0, interval: 1 },
  { action: "createSlider", x: -450, y: 0,   nickName: "Total Twist", min: 0, max: 360, value: 90, digits: 1, interval: 5 },
  { action: "createSlider", x: -450, y:-100, nickName: "Floor Height",min: 0.1, max: 10, value: 4, digits: 2, interval: 0.1 },
])
gh_get_canvas()

# === LOGIC LAYER (right of parameters) ===
# Generate floor indices and compute per-floor Z rotation using Z for elevation

gh_edit_components(items: [
  { action: "add", componentType: "<series-guid>",    x: -280, y: 100, nickName: "Floor Indices" },
  { action: "add", componentType: "<expression-guid>", x: -140, y: 100, nickName: "Z Elevation" },
  # Formula: i * h  (floor_index * floor_height) → outputs double (elevation in Z)
  { action: "add", componentType: "<expression-guid>", x: -140, y: 0,   nickName: "Per-Floor Rotation" },
  # Formula: (i / n) * t  (normalized twist) → outputs double (angle)
])
gh_get_canvas()

# Wire parameters to logic
gh_edit_wire(items: [
  # Floors (int) → Series N (int) ✓
  { action: "connect", fromComponent: "<floors-guid>", fromPort: "<output>", toComponent: "<series-guid>", toPort: "<N>" },
  # Series (int list) → Z Expr x (will be treated as double in math) ✓
  { action: "connect", fromComponent: "<series-guid>", fromPort: "<range>", toComponent: "<z-expr-guid>", toPort: "<x>" },
  # Floor Height (double) → Z Expr y ✓
  { action: "connect", fromComponent: "<height-guid>", fromPort: "<output>", toComponent: "<z-expr-guid>", toPort: "<y>" },
  # Floors (int) → Rotation Expr n (total count for normalization) ✓
  { action: "connect", fromComponent: "<floors-guid>", fromPort: "<output>", toComponent: "<rot-expr-guid>", toPort: "<n>" },
  # Series (list) → Rotation Expr i (current index) ✓
  { action: "connect", fromComponent: "<series-guid>", fromPort: "<range>", toComponent: "<rot-expr-guid>", toPort: "<i>" },
  # Total Twist (double) → Rotation Expr t ✓
  { action: "connect", fromComponent: "<twist-guid>", fromPort: "<output>", toComponent: "<rot-expr-guid>", toPort: "<t>" },
])

# === GEOMETRY LAYER (right of logic) ===

gh_edit_components(items: [
  { action: "add", componentType: "<circle-guid>",  x: 20,  y: 50,  nickName: "Floor Circle" },
  # Base Radius (double) → Circle Radius (double) ✓
])
gh_get_canvas()

gh_edit_wire(items: [
  { action: "connect", fromComponent: "<radius-guid>", fromPort: "<output>", toComponent: "<circle-guid>", toPort: "<radius>" },
])

# === TRANSFORM LAYER (right of geometry) ===
# Move circles up in Z (NOT Y!), then rotate

gh_edit_components(items: [
  { action: "add", componentType: "<unitz-guid>",      x: 120, y: 120, nickName: "Z Direction" },
  { action: "add", componentType: "<multiply-guid>",   x: 220, y: 120, nickName: "Z Vector" },
  # Z Elev (double) × Unit Z (vector) → Vector3d (move direction in Z axis) ✓
  { action: "add", componentType: "<move-guid>",       x: 340, y: 50,  nickName: "Stack Floors" },
  # Geometry (Curve) + Move Vector (Vector3d) → moved Curves ✓
  { action: "add", componentType: "<rotate-guid>",     x: 460, y: 50,  nickName: "Twist Floors" },
  # Need a Z-axis for rotation plane — circles are in XY, rotate around Z
  { action: "add", componentType: "<unitz-guid>",      x: 340, y: -20, nickName: "Rotation Axis" },
])
gh_get_canvas()

gh_edit_wire(items: [
  # Z Elev expression result → Multiply A (double × vector = vector) ✓
  { action: "connect", fromComponent: "<z-expr-guid>",   fromPort: "<result>", toComponent: "<z-mul-guid>",   toPort: "<A>" },
  { action: "connect", fromComponent: "<unitz-guid>",    fromPort: "<vector>", toComponent: "<z-mul-guid>",   toPort: "<B>" },
  # Z Vector → Move direction (Vector3d ✓)
  { action: "connect", fromComponent: "<z-mul-guid>",    fromPort: "<result>", toComponent: "<move-guid>",    toPort: "<motion>" },
  # Circle → Move geometry (Curve ✓)
  { action: "connect", fromComponent: "<circle-guid>",   fromPort: "<curve>",  toComponent: "<move-guid>",    toPort: "<geometry>" },
  # Moved circles → Rotate geometry (Curve ✓)
  { action: "connect", fromComponent: "<move-guid>",     fromPort: "<result>", toComponent: "<rotate-guid>",   toPort: "<geometry>" },
  # Rotation angle (double) → Rotate angle ✓
  { action: "connect", fromComponent: "<rot-expr-guid>", fromPort: "<result>", toComponent: "<rotate-guid>",   toPort: "<angle>" },
  # Unit Z as rotation axis (Vector3d → plane axis) ✓
  { action: "connect", fromComponent: "<unitz-guid>",    fromPort: "<vector>", toComponent: "<rotate-guid>",   toPort: "<plane>" },  # or appropriate plane port
])

# === OUTPUT LAYER (far right) ===

gh_edit_components(items: [
  { action: "add", componentType: "<loft-guid>", x: 580, y: 50, nickName: "Tower Volume" },
  # Loft takes list of closed curves → Brep (surface/solid) ✓
])
gh_get_canvas()

gh_edit_wire(items: [
  { action: "connect", fromComponent: "<rotate-guid>", fromPort: "<result>", toComponent: "<loft-guid>", toPort: "<curves>" },
])

gh_get_canvas()  # final verification
```

**Complete tower wiring reference:**

| From (type) | To (type) | Port Match | Notes |
|-------------|-----------|------------|-------|
| Floors (int) | Series N (int) | int → int | Floor count |
| Series (int\[]) | Z Expr x (double) | list → scalar (implicit) | Index variable |
| Floor Height (double) | Z Expr y (double) | double → double | Height multiplier |
| Z Expr result (double) | Multiply A (double) | double → double | Elev magnitude |
| Unit Z (Vector3d) | Multiply B (Vector3d) | vector → vector | Direction |
| Multiply result (Vector3d) | Move motion (Vector3d) | vector → vector | Z-up movement |
| Circle (Curve) | Move geometry (Curve) | curve → curve | Input shape |
| Move result (Curve) | Rotate geometry (Curve) | curve → curve | Stacked shape |
| Rotation Expr (double) | Rotate angle (double) | double → double | Per-floor angle |
| Unit Z (Vector3d) | Rotate plane (Plane) | vector → plane | Axis of rotation |
| Rotate result (Curve\[]) | Loft curves (Curve\[]) | curve[] → curve[] | Final volume |

**Layout visualization:**

```
[Base Radius] ─┐
[Floors] ──────┤→[Series]→[Z Elev Expr]──┐
[Total Twist] ─┤→[Rot Expr]──────────────┤
[Floor Ht] ────┘                        ↓
                    [Circle] → [Move] → [Rotate] → [Loft]
                                        ↑
                              [Unit Z]→[Multiply]
```

### Example 3: Reciprocal Frame Pavilion

Interlocking beam canopy — demonstrates radial geometry in the X-Y plane with Z extrusion.

```text
gh_list_components(queries: ["point", "polar array", "line tt", "pipe",
                              "construct point", "unit z"])

# Parameters (top-left: global drivers)
gh_edit_slider(items: [
  { action: "createSlider", x: -300, y: 150, nickName: "Beam Count",      min: 3, max: 24, value: 12, digits: 0, interval: 1 },
  { action: "createSlider", x: -300, y: 50,  nickName: "Inner Radius",    min: 0, max: 30, value: 8,  digits: 2, interval: 0.5 },
  { action: "createSlider", x: -300, y: -50, nickName: "Outer Radius",    min: 5, max: 50, value: 20, digits: 2, interval: 1 },
  { action: "createSlider", x: -300, y:-150, nickName: "Beam Height (Z)",  min: 0, max: 10, value: 2,  digits: 2, interval: 0.1 },
])
gh_get_canvas()

# Center point (origin, in X-Y plane at Z=0)
gh_edit_components(items: [
  { action: "add", componentType: "<point-guid>",  x: -100, y: 0,   nickName: "Center Point" },  # Point3d
])
gh_get_canvas()

# Radial generation (right of center + params)
gh_edit_components(items: [
  { action: "add", componentType: "<polar-guid>",  x: 40,  y: 50,  nickName: "Radial Points" },
  { action: "add", componentType: "<line-guid>",   x: 180, y: 50,  nickName: "Beam Lines" },    # Curve output
])
gh_get_canvas()
# Wire: Center → Polar, Count+Radii → Polar, Polar → Line

# Extrusion in Z direction (right of lines)
gh_edit_components(items: [
  { action: "add", componentType: "<unitz-guid>",    x: 180, y: -30,  nickName: "Extrude Dir Z" },  # Vector3d
  { action: "add", componentType: "<extrude-guid>",  x: 300, y: 50,   nickName: "Extrude Beams" },  # Surface output
  { action: "add", componentType: "<pipe-guid>",     x: 420, y: 50,   nickName: "Pipe Beams" },     # Brep output (optional)
])
gh_get_canvas()
# Wire: Lines → Extrude Geometry, Unit Z → Extrude Direction, Extrude → Pipe (if used)

gh_get_canvas()  # verify
```

### Example 4: Modify Existing Components (Batch)

```text
gh_get_canvas()

gh_edit_slider(items: [{ action: "setValue", targetId: "<slider-guid>", value: 25 }])
gh_edit_components(items: [{ action: "set_hidden", targetId: "<panel-guid>", hidden: true }])

gh_get_canvas()  # confirm both
```

### Example 5: Search & Delete

```text
gh_get_canvas()
# scan for Panel with text "result" → instanceGuid = "xyz-789"

gh_edit_components(items: [{ action: "delete", targetId: "xyz-789" }])
gh_get_canvas()
```

---

## 6. Creating Your Own Geometry Patterns

When generating geometry not covered above, follow this strategy:

1. **Identify parameters** — what should the user control? Classify each as **global driver** (top-left) or **local input** (next to its component).
2. **Sketch the data flow left-to-right before building:**
   ```
   PARAMETERS → DATA GENERATION → GEOMETRY CREATION → TRANSFORM → OUTPUT
   (left)                                                       (right)
   ```
3. **Verify every connection's data type** — trace each wire and confirm source output type matches target input type. Pay special attention to:
   - Point vs Vector
   - Curve vs Surface/Brep
   - Domain vs Number/String vs Number
   - Single item vs List
4. **Use Z for elevation always** — never stack in Y.
5. **Work in batches**: add ~10 components, `gh_get_canvas`, wire that layer, repeat.
6. **Set descriptive `nickName`** on every component.
7. **Group logical sections** after verification: Parameters, Logic, Geometry, Transform, Output.

---

## 7. Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Tool hangs / no response | Backend not running | Verify Rhino + rhino-zmq-poc plugin is open |
| `gh_edit_wire` (action="connect") fails | Stale GUIDs | Re-run `gh_get_canvas` to get fresh GUIDs |
| Component not visible after add | Added off-canvas | Check coordinates; use `gh_edit_components` with action="move" to reposition |
| Slider value rejected | Outside min/max range | Use `gh_get_canvas` to read slider's current min/max first, or use `gh_edit_slider` with action="editRange" to change the range before setting value |
| Wire connection does nothing | Wrong port direction | Ensure `fromPort` is an OUTPUT and `toPort` is an INPUT (use action="connect" in gh_edit_wire) |
| Component shows error after wire | **Data type mismatch** | Check source output type vs target input type (Section 1.4) |
| Geometry invisible / wrong location | **Used Y instead of Z for elevation** | Check all Move/Rotate/Construct components — Z is up (Section 1.3) |
| Only one result when expecting many | **Single item implicitly consumed** | Check if a list input is receiving a single item; verify data is actually a list |
| Wires cross chaotically | Poor layout | Reorganize left-to-right; group related rows vertically |
