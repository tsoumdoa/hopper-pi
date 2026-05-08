---
name: generate-geometry
description: Generate architectural parametric geometry on the Grasshopper canvas. Use when the user asks to create, build, or generate interesting geometry, architectural forms, parametric structures, towers, facades, pavilions, or any showcase piece on the Grasshopper canvas.
---

# Parametric Geometry Generation

This skill guides you through generating impressive architectural geometry on the Grasshopper canvas using the 14 Grasshopper tools. The definitions are designed to be visually striking and demonstrate parametric design principles.

## Core Principles

1. **Always call `gh_get_canvas` first** — know what's already there
2. **Always call `gh_list_components` to find exact GUIDs** — never guess component type GUIDs
3. **After each batch of adds, call `gh_get_canvas`** — you need port GUIDs for wiring
4. **Build in small batches (≤10 nodes)** — keep it manageable
5. **Re-fetch after every add before wiring** — new components need their port GUIDs resolved

## Execution Strategy

### Phase 1: Discovery
```
1. gh_get_canvas()                     — see current state
2. gh_list_components(filter: "slider") — find Number Slider GUID
3. gh_list_components(filter: "panel")  — find Panel GUID
4. gh_list_components(filter: "range")  — find Range/Series GUID
5. gh_list_components(filter: "curve")  — find curve-related components
6. gh_list_components(filter: "surface") — find surface components
7. gh_list_components(filter: "point")  — find point components
```

### Phase 2: Build in batches
Each batch: add ≤10 components → gh_get_canvas → wire → verify → next batch

### Phase 3: Wire and validate
After all components are placed, make all connections, then do a final gh_get_canvas to verify.

---

## Definition: Twisted Parametric Tower

A 30-story twisting tower with parametric floor plates that rotate as they rise. The twist angle, floor count, and plan radius are all controllable via sliders. The facade has variable-sized apertures driven by a graph mapper for a visually striking result.

### Architecture Overview

```
INPUTS (left side, x=-400):
  ┌─────────────────┐
  │ Base Radius (15) │──────┐
  │ Floors (30)      │──────┤
  │ Twist Angle (90°)│──────┤
  │ Floor Height (4) │──────┤
  │ Base Point (0,0) │──────┤
  └─────────────────┘      │
                           ▼
GENERATION (center, x=-100):  ┌──────────────────────┐
                              │ Series (floor indices)│
                              │ Expression (height)   │
                              │ Expression (rotation) │
                              │ Polar Point (centers) │
                              │ Circle (floor plates) │
                              │ Loft (tower volume)   │
                              └──────────────────────┘
                                         │
                                         ▼
FACADE (right, x=200):       ┌──────────────────────┐
                              │ Divide Curve (perims) │
                              │ Graph Mapper (apert.) │
                              │ Scale (variable)      │
                              │ Extrude (frame depth)  │
                              └──────────────────────┘
```

### Batch 1: Input Parameters (5 components)

Add 4 sliders and 1 point parameter:

| # | Type | Position | Nickname | Notes |
|---|------|----------|----------|-------|
| 1 | Number Slider | (-400, 200) | "Base Radius" | min=5, max=30, default=15 |
| 2 | Number Slider | (-400, 100) | "Floors" | min=5, max=60, default=30 |
| 3 | Number Slider | (-400, 0) | "Twist (deg)" | min=0, max=360, default=90 |
| 4 | Number Slider | (-400, -100) | "Floor Height" | min=2, max=8, default=4 |
| 5 | Point (World XY) | (-400, -250) | "Base Origin" | default {0,0,0} |

After adding → `gh_get_canvas()` → record all port GUIDs.

### Batch 2: Core Generation (5 components)

| # | Type | Position | Nickname | Notes |
|---|------|----------|----------|-------|
| 6 | Series | (-150, 200) | "Floor Series" | N = Floors slider, Step = 1 |
| 7 | Expression | (-150, 100) | "Height" | Formula: `x * Floor_Height` |
| 8 | Expression | (-150, 0) | "Angle per Floor" | Formula: `(x / Floors) * Twist` |
| 9 | Polar Point | (-50, 100) | "Floor Centers" | R=0, A=Angle expression (gives Z-height centers) |
| 10 | Construct Point | (-50, 0) | "Plan Center" | Actually, use Point XYZ component |

**Better approach — use Expression for Z + rotation:**

| # | Type | Position | Nickname | 
|---|------|----------|----------|
| 6 | Series | (-150, 150) | "Floor Index" |
| 7 | Expression | (-50, 150) | "Floor Z" | Formula: `i * h` (i=index, h=floor height) |
| 8 | Expression | (-50, 50) | "Rotation" | Formula: `(i/n) * t` (i=index, n=floors, t=twist) |
| 9 | Rotate | (50, 100) | "Rotate Planes" | Rotates XY planes at each floor height |
| 10 | Circle | (150, 100) | "Floor Circles" | Plane = rotated planes, Radius = base radius |

**Even better — simpler and more robust:**

| # | Type | Position | Nickname |
|---|------|----------|----------|
| 6 | Series | (-150, 100) | "Floor Index" |
| 7 | Construct Point | (-50, 100) | "Floor Centers" | X=0, Y=0, Z=Expression(i*h) |
| 8 | Horizontal Frame | (50, 100) | "Floor Planes" | At each center point |
| 9 | Rotate | (150, 0) | "Twist Planes" | Rotate planes around Z by per-floor angle |
| 10 | Circle | (250, 0) | "Floor Outlines" | Planes from rotate, radius from slider |

### Batch 3: Tower Volume (3 components)

| # | Type | Position | Nickname |
|---|------|----------|----------|
| 11 | Loft | (350, 0) | "Tower Loft" |
| 12 | Cap Holes | (450, 0) | "Cap Top/Bottom" |
| 13 | Deconstruct Brep | (350, -150) | "Get Surfaces" | For facade panels |

### Batch 4: Facade Detail (4 components)

| # | Type | Position | Nickname |
|---|------|----------|----------|
| 14 | Divide Curve | (200, -200) | "Panel Divisions" | Divide each floor circle |
| 15 | Graph Mapper | (300, -200) | "Aperture Scale" | Sine wave or Bezier for variable openings |
| 16 | Scale | (400, -200) | "Scale Panels" | Variable scale based on graph |
| 17 | Extrude | (500, -200) | "Panel Depth" | Give panels thickness |

### Wiring Plan

```
Number Slider "Floors" → Series "N" input
Series "Range (S)" → Expression "Floor Z" variable i
Number Slider "Floor Height" → Expression "Floor Z" variable h  
Expression "Floor Z" → Construct Point "Z" input
Construct Point → Horizontal Frame "Curve" (use unit Z line? No...)

-- Simpler wiring --
Floors (slider) → Series (N input)
Series (Range output) → Expression (i variable)
Floor Height (slider) → Expression (h variable)  
Expression → Construct Point (Z input)
Base Radius (slider) → Circle (Radius input)
Twist (slider) → Expression (t variable)
Floors (slider) → Expression (n variable)
Series → Expression (i variable)
Expression (rotation) → Rotate (Angle input)
```

**SIMPLEST viable approach:**

```
Inputs:
  Slider "Radius" (15) ──────────────────────────┐
  Slider "Floors" (30) ──→ Series N ──┐           │
  Slider "Height" (4)  ──┐             │           │
                        ▼             ▼           ▼
  Series (0..N, step=1) → Multiply(index, height) → Move(circle, vector)
                        ──→ Multiply(index, twist/N) → Rotate(circle, angle)
  
  Circle(plane, radius) → Move(Z) → Rotate(angle) → Loft → Cap → Brep
```

### Actual Execution Steps (the precise tool calls)

This is the exact sequence of tool calls to make:

#### Step 1: Discovery
```
gh_get_canvas()
gh_list_components(filter: "series")
gh_list_components(filter: "multiply") 
gh_list_components(filter: "construct")
gh_list_components(filter: "move")
gh_list_components(filter: "rotate")
gh_list_components(filter: "loft")
gh_list_components(filter: "circle")
gh_list_components(filter: "unit")
gh_list_components(filter: "vector")
gh_list_components(filter: "expression")
gh_list_components(filter: "graph")
gh_list_components(filter: "divide")
gh_list_components(filter: "scale")
gh_list_components(filter: "extrude")
gh_list_components(filter: "cap")
```

#### Step 2: Add input sliders
```
gh_add_component(componentType: "<slider-guid>", x: -400, y: 200, nickName: "Base Radius")
gh_add_component(componentType: "<slider-guid>", x: -400, y: 100, nickName: "Floors")
gh_add_component(componentType: "<slider-guid>", x: -400, y: 0, nickName: "Twist")
gh_add_component(componentType: "<slider-guid>", x: -400, y: -100, nickName: "Floor Height")
gh_get_canvas()  // get port GUIDs for sliders
```

#### Step 3: Configure sliders
```
gh_set_slider_value(targetId: "Base Radius", value: 15)
gh_set_slider_value(targetId: "Floors", value: 30)
gh_set_slider_value(targetId: "Twist", value: 90)
gh_set_slider_value(targetId: "Floor Height", value: 4)
```

#### Step 4: Add generation components
```
gh_add_component(componentType: "<series-guid>", x: -200, y: 150, nickName: "Floor Index")
gh_add_component(componentType: "<expression-guid>", x: -100, y: 50, nickName: "Z Position")
gh_add_component(componentType: "<expression-guid>", x: -100, y: -50, nickName: "Rotation Angle")
gh_add_component(componentType: "<circle-guid>", x: 0, y: 50, nickName: "Base Circle")
gh_get_canvas()
```

#### Step 5: Continue generation
```
gh_add_component(componentType: "<move-guid>", x: 100, y: 50, nickName: "Move Up")
gh_add_component(componentType: "<rotate-guid>", x: 200, y: 50, nickName: "Twist")
gh_add_component(componentType: "<loft-guid>", x: 300, y: 50, nickName: "Loft Tower")
gh_get_canvas()
```

#### Step 6: Wire everything (using GUIDs from gh_get_canvas)
```
// Series ← Floors count
gh_connect_wire(fromComponent: "<Floors-guid>", fromPort: "<output>", toComponent: "<Series-guid>", toPort: "<N-input>")

// Expression Z ← Series output
gh_connect_wire(fromComponent: "<Series-guid>", fromPort: "<Range>", toComponent: "<Z-Pos-guid>", toPort: "<x-input>")

// Expression Z ← Floor Height
gh_connect_wire(fromComponent: "<FloorHeight-guid>", fromPort: "<output>", toComponent: "<Z-Pos-guid>", toPort: "<y-input>")

// etc.
```

#### Step 7: Verify and report
```
gh_get_canvas()  // final check
```

---

## Definition: Parametric Pavilion (Alternative)

A reciprocal frame pavilion — interlocking beams that form a canopy. Simpler but visually stunning.

### Components needed:
- Number Slider: Beam Count (8-24)
- Number Slider: Inner Radius
- Number Slider: Outer Radius
- Number Slider: Beam Height
- Polar Array → Lines → Pipe → Display

### Execution:
1. Add 4 sliders
2. Add Point component (center)
3. Add Polar Array
4. Add Line (TT)
5. Add Pipe
6. Wire and go

---

## Tips for Impressive Results

1. **Use Loft** for smooth transitions between sections — the single most visually impactful component
2. **Graph Mapper** adds organic variation — sine/bezier for natural-looking facades
3. **Rotate + Move combined** creates twisting towers — the architectural classic
4. **Series is your friend** — it generates the index/parameter arrays that drive everything parametric
5. **Expression components** replace complex math chains — `x*y` instead of multiply components
6. **Pipe** turns any curve into a 3D tube — instant structural members
7. **Scale NU** enables non-uniform scaling — egg shapes, stretched forms
8. **Boolean operations** (union, difference) create complex solid geometry
9. **Always cap holes** after loft for watertight geometry
10. **Construct Point + Unit Z + Amplitude** gives you offset vectors for stacking
