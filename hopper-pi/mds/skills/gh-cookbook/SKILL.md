---
name: gh-cookbook
description: Repeatable recipe cards for common Grasshopper patterns — rectangle from plane/domain, surface subdivision, edge extraction, lofting, extrusion, piping, dispatch/patterning, point population, and more. Use when the user asks to build any of these typical workflows.
---

# Grasshopper Cookbook

## Role
You are a pattern library, not a theory textbook. Each recipe is a **self-contained build card**: components, wiring, data flow, and typical next steps. No cross-references needed — follow the card, place the parts, wire it up.

## How to use
1. Match the user's goal to a recipe below.
2. Follow the component table and wiring diagram **exactly**.
3. Place all components first → `gh_get_canvas` once → wire everything (per [gh-modeling-expert](./gh-modeling-expert/SKILL.md) tier rules).
4. Check "Typical next steps" for where the output usually feeds into.

---

## Recipe 0 — Rectangle Surface from Plane + Domain

**What:** Creates a planar rectangular surface defined by a base plane and U/V extent values. This is the standard way to set up a parametric working surface — it's lightweight, explicit, and easy to resize.

| Step | Component | Config | Notes |
|------|-----------|--------|-------|
| Plane | **Plane** (XY / origin) | — | Base plane (default XY at origin is common) |
| U Domain | **Domain** or **Construct Domain** | e.g. `0 to 20` | Width / U extent |
| V Domain | **Domain** or **Construct Domain** | e.g. `0 to 15` | Height / V extent |
| Surface | **Surface** (from plane) | — | Outputs a planar rectangular surface |

**Wiring:**
```
  Plane ──→ Surface.P (or implicit base plane input)
U_Domain ──→ Surface.U (domain in U direction)
V_Domain ──→ Surface.V (domain in V direction)
            Surface → rectangular planar surface
```

**Alternative — single Plane Surface component:**
```
  Plane    ──→ Plane Surface.P
   X_Size  ──→ Plane Surface.X (width, e.g. 20)
   Y_Size  ──→ Plane Surface.Y (height, e.g. 15)
              Plane Surface → same result, simpler setup
```

**Output:** A single planar rectangular surface.

**Typical next steps:**
- This is almost always the **starting surface** fed into **Recipe 1** (Subdivide), **Recipe 7** (Populate Points), or **Recipe 4** (Extrude).
- Change the plane origin/orientation to orient your rectangle non-axially.
- Use sliders for U/V domain extents to make the rectangle parametrically resizable.

---

## Recipe 1 — Subdivide Surface by UV Domain

**What:** Splits a surface into a U×V grid of subsurface patches.

| Step | Component | Config | Notes |
|------|-----------|--------|-------|
| Input | **Surface** param | — | Base surface |
| Count U | **Panel** or **Slider** | e.g. `5` | Segments in U direction |
| Count V | **Panel** or **Slider** | e.g. `8` | Segments in V direction |
| Divide | **Divide Domain²** | — | Splits the surface domain |
| Trim | **Isotrim (SubSrf)** | — | Extracts subsurfaces from domains |

**Wiring:**
```
Surface ──→ Divide.I          Surface ──→ SubSrf.S
 Panel_U ──→ Divide.U           Divide.S ──→ SubSrf.D  → list of subsurfaces
 Panel_V ──→ Divide.V
```

**Output:** List of `U × V` surface patches (e.g. 5×8 = 40 surfaces).

**Typical next steps:**
- Feed `SubSrf.S` into **Extrude** for thickness / fins
- Feed into **Dispatch** + **Custom Preview** for checkerboard or alternating patterns
- Use **Brep Components** (or *Deconstruct Brep*) to extract edges of each patch → **Pipe**
- Feed into **Evaluate Surface** + **Move** for surface-normal displacement

---

## Recipe 2 — Extract & Organize Surface Edges

**What:** Gets the edge curves of a surface or brep, organized by edge type (outer boundary vs. inner loops / trims).

| Step | Component | Config | Notes |
|------|-----------|--------|-------|
| Input | **Surface** or **Brep** | — | Geometry to extract edges from |
| Explode | **Deconstruct Brep** | — | Faces (F), Edges (E), Vertices (V) |
| — OR — | **Brep Edges** | — | Returns edges organized by type |

**Wiring (Deconstruct Brep path):**
```
Surface/Brep ──→ Deconstruct Brep.B
                         ├── F → faces (surfaces)
                         ├── E → all edge curves (flat list)
                         └── V → vertices
```

**Wiring (Brep Edges path — cleaner for edge-only work):**
```
Surface/Brep ──→ Brep Edges.B
                          ├── E → exterior (outer boundary) edges
                          └── I → interior (hole/trim loop) edges
```

**Output:** Edge curves ready for **Pipe**, **Offset**, **Loft**, or **Extrude**.

**Typical next steps:**
- **Pipe** the exterior edges for wireframe / structural frames
- **Offset** edges inward for inset panels
- **Loft** between offset and original edges for raised borders
- After Recipe 1: feed `SubSrf.S` → `Deconstruct Brep` → get per-patch edges

---

## Recipe 3 — Loft Between Curves

**What:** Creates a surface lofted through two or more profile curves.

| Step | Component | Config | Notes |
|------|-----------|--------|-------|
| Curves | **Curve** params (2+) | — | Profile curves to loft through |
| Loft | **Loft** | — | Connects sections with a surface |

**Wiring:**
```
Curve_1 ─┐
Curve_2 ─┼──→ Loft.C   → lofted surface
Curve_3 ─┘         (rebuild/reconnect optional)
```

**Key tips:**
- Curves must be in order (use **Shift List** if direction needs fixing).
- All curves should generally point the same direction — flip with **Flip Curve** if the loft twists.
- For closed profiles (e.g., rounded rectangles), loft produces a solid-like brep.

**Typical next steps:**
- **Cap Holes** (if profiles are closed) to make a solid brep
- **Extrude** the lofted surface for thickness
- **Split** the loft with cutting geometry for trimmed forms

---

## Recipe 4 — Extrude Curves / Surfaces

**What:** Linear extrusion of curves or surfaces along a direction vector.

| Step | Component | Config | Notes |
|------|-----------|--------|-------|
| Geometry | **Curve** or **Surface** | — | What to extrude |
| Direction | **Vector** or **Unit Z** | — | Extrusion direction |
| Distance | **Number Slider** | e.g. `0 to 50` | How far to extrude |
| Extrude | **Extrude** | — | Does the extrusion |

**Wiring:**
```
Geometry ──→ Extrude.B
 Vector   ──→ Extrude.D
            Extrude.D (distance) can be built as:
               Unit_Z ──→ Amplitude (A=slider) ──→ Extrude.D
```

**Common shortcut for simple Z-extrusion:**
```
Curve ──→ Extrude(B)
Unit Z ──→ Extrude(D)
        (set extrusion distance via Amplitude on the vector)
```

**Output:** Extruded surface (from curve) or polysurface (from surface).

**Typical next steps:**
- After Recipe 1 (`SubSrf.S`): extrude each patch at different heights for a **facade screen** effect
- Cap open ends with **Cap Holes** for solids
- Boolean operations (**Solid Difference**, **Union**) with other extruded forms

---

## Recipe 5 — Pipe / Sweep Profile on Curves

**What:** Creates a tubular radius around one or more curves (pipes) or sweeps a custom section along a rail.

### 5a. Simple Pipe

| Step | Component | Config | Notes |
|------|-----------|--------|-------|
| Curves | **Curve** | — | Rail curve(s) |
| Radius | **Number Slider** | e.g. `0.1 to 5` | Pipe thickness |
| Pipe | **Pipe** | — | Creates pipe geometry |

**Wiring:**
```
Curves ──→ Pipe.C
 Radius ──→ Pipe.R    → piped geometry (closed breps)
```

### 5b. Custom Sweep (1-rail)

| Step | Component | Config | Notes |
|------|-----------|--------|-------|
| Section | **Curve** | — | Cross-section shape (e.g., rectangle, L-profile) |
| Rail | **Curve** | — | Path curve to sweep along |
| Sweep | **Sweep1** | — | Sweeps section along rail |

**Wiring:**
```
Section ──→ Sweep1.S
   Rail ──→ Sweep1.R   → swept surface/brep
```

**Typical next steps:**
- After Recipe 2 (edge extraction): pipe the edges for **structural framing**
- After Recipe 1 + Recipe 2: pipe every patch edge for a **grid/mesh look**
- Sweep custom profiles (L-channels, T-beams) along edges for **architectural detailing**

---

## Recipe 6 — Dispatch / Pattern Alternation

**What:** Splits a list into two outputs using a boolean pattern — ideal for checkerboards, alternating colors, or skipping every Nth item.

| Step | Component | Config | Notes |
|------|-----------|--------|-------|
| Input List | (any geometry list) | — | E.g., `SubSrf.S` output from Recipe 1 |
| Pattern | **Pattern** panel | `"true;false"` or `"0;1"` | Alternating toggle |
| Dispatch | **Dispatch** | — | Splits list into A and B |

**Wiring:**
```
InputList ──→ Dispatch.L
  Pattern ──→ Dispatch.P
                    ├── Dispatch.A → items where pattern = true
                    └── Dispatch.B → items where pattern = false
```

**Common patterns:**

| Pattern string | Effect |
|----------------|--------|
| `true;false` | Alternating ABABAB… |
| `true;true;false;false` | Pairs: AABBAA… |
| `true;false;false;false` | Every 4th: ABBBABBB… |

**Typical next steps:**
- Route `Dispatch.A` and `Dispatch.B` into two **Custom Preview** nodes with **different Colour Swatches** → checkerboard facade
- Apply **Extrude** to only the `A` group for a **projecting-select-patches** effect
- Use **Cull Index** or **Cull N** as alternatives for simpler removal patterns

---

## Recipe 7 — Populate Points on Surface

**What:** Generates an evenly distributed set of points across a surface, with UV coordinates for evaluation.

| Step | Component | Config | Notes |
|------|-----------|--------|-------|
| Surface | **Surface** | — | Target surface |
| Count U | **Number Slider/Panel** | e.g. `10` | Points in U direction |
| Count V | **Number Slider/Panel** | e.g. `10` | Points in V direction |
| Divide | **Divide Surface** | — | Generates point grid on surface |
| — OR — | **Populate Geometry** | — | Random distribution (count + seed) |

**Wiring (Grid path):**
```
Surface ──→ Divide Surface.S
  Count_U ──→ Divide Surface.U
  Count_V ──→ Divide Surface.V
              Divide Surface.Pt → list of {x,y,z} points
              Divide Surface.UV → corresponding {u,v} coordinates
```

**Wiring (Random path):**
```
Surface ──→ Populate Geometry.G
   Count ──→ Populate Geometry.N     (number slider)
    Seed ──→ Populate Geometry.S     (number slider, for variation)
              Populate Geometry.P → random points on surface
```

**Typical next steps:**
- Feed points into **Evaluate Surface** (with same surface) to get normals/tangents at each point
- **Deconstruct Point** → **Construct Point** with displaced Z for **surface punctuation**
- **Circle** (at each point, in tangent plane) → **Extrude** for **bolts/studs pattern**
- **Line SDL** (point + surface normal as direction) → **Pipe** for **surface bristles/quills**

---

## Recipe 8 — Project Points onto Geometry

**What:** Projects points onto a surface or brep along a specified direction (usually Z-axis / construction plane normal).

| Step | Component | Config | Notes |
|------|-----------|--------|-------|
| Points | **Point** | — | Source points to project |
| Geometry | **Surface / Brep** | — | Target to project onto |
| Direction | **Vector** (often **Unit Z**) | — | Projection ray direction |
| Project | **Project Point** | — | Performs the projection |

**Wiring:**
```
  Points ──→ Project Point.P
 Geometry ──→ Project Point.G
 Direction ──→ Project Point.D
             Project Point.P → projected points (on surface)
             Project Point.I → index of which face/brep was hit (-1 = miss)
```

**Typical next steps:**
- After Recipe 7: generate points in 3D space → project them down onto a wavy surface for **terrain-following placement**
- Pull projected points back with **Pull Point** to find closest-point parameters
- Use projected points + **Evaluate Surface** for **normal-aligned objects** on complex surfaces

---

## Composition Examples

These show how recipes chain together in real workflows.

### Facade Screen (Recipe 0 + Recipe 1 + Recipe 4 + Recipe 6)
```
Recipe 0 (Rectangle) → Divide Domain² (5×8) → Isotrim
                                        ├→ Dispatch (alternating)
                                        │    ├→ A → Extrude(height=30) → CustomPreview(white)
                                        │    └→ B → CustomPreview(grey)
                                        └→ (original patches remain flat)
```
Result: A building facade where every other panel projects outward.

### Structural Grid (Recipe 0 + Recipe 1 + Recipe 2 + Recipe 5a)
```
Recipe 0 (Rectangle) → Divide Domain² (N×M) → Isotrim → Deconstruct Brep
                                                    └→ E (edges) → Pipe(R=0.15)
```
Result: A piped-edge grid following surface curvature — like a space-frame or glazed roof structure.

### Surface Studs (Recipe 7 + Evaluate Surface + Recipe 5a)
```
Surface → Divide Surface (U=12, V=12) → Pt
                                            ├→ Evaluate Surface(S=surface, uv=UV)
                                            │    └→ N (normals)
                                            └→ Line SDL(P=Pt, D=N, L=length)
                                                 └→ Pipe(R=radius)
```
Result: Normal-aligned pipes radiating from a surface — like an acoustic baffle or decorative quill field.

---

## Guidelines for Adding New Recipes

When adding a new recipe to this cookbook:

1. **Name it for the outcome**, not the tool. ("Subdivide Surface" not "Divide Domain² Recipe")
2. **Component table first** — what's needed, what config, notes column for gotchas.
3. **ASCII wiring diagram** — left-to-right flow, clear port labels.
4. **Output** — what comes out and what data shape it has (list? tree? single?).
5. **Typical next steps** — where this output usually feeds (link to other recipes by number).
6. **Keep it under 30 lines** per recipe. If it's longer, split into sub-recipes (like 5a/5b).
7. **Add a composition example** when a combination comes up repeatedly in real sessions.
