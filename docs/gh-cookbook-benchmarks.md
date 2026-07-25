# GH Cookbook — Benchmark Prompts

> **Human QA only** — not agent runtime guidance. Operational recipes live in `mds/skills/gh-cookbook/`.

Use these prompts to test how well the agent follows each recipe. Prompts are grouped by **tier** (complexity) and tagged with which **recipe(s)** they exercise.

## Scoring Criteria

For each prompt, check:

| Check | What to look for |
|-------|------------------|
| ✅ **Right components** | Correct component types placed (no missing or extra nodes) |
| ✅ **Correct wiring** | All ports connected properly, no dangling wires |
| ✅ **Correct values** | Sliders/panels set to reasonable defaults matching the prompt |
| ✅ **Clean layout** | Left-to-right flow, inputs on left, tight spacing, grouped |
| ✅ **Preview** | Final output has Custom Preview + Swatch, intermediates hidden |
| ✅ **Atomic build** | New graph normally uses one `gh_apply_graph` call and no canvas reread |

---

## Tier 1 — Single Recipe (Warm-up)

These test one recipe in isolation. Should be ~5–10 components max.

### T1-01 — Rectangle Surface `[Recipe 0]`

> **Prompt:** Make a rectangular surface on the XY plane, 30 units wide and 20 units tall. Use sliders so I can resize it later.

**Expected:** Plane → Surface (or Plane Surface) with X=30, Y=20 as sliders. Clean left-to-right.

---

### T1-02 — Subdivide a Surface `[Recipe 1]`

> **Prompt:** Take the surface on canvas and subdivide it into a 6×9 grid of smaller surface patches.

**Expected:** Divide Domain² (U=6, V=9 via panels) + Isotrim, wired to existing Srf. Output is list of 54 patches.

---

### T1-03 — Extract Edges `[Recipe 2]`

> **Prompt:** Extract all the edge curves from this brep/surface. Give me the outer boundary edges separately from any interior edges.

**Expected:** Deconstruct Brep or Brep Edges component, with E and I outputs identifiable.

---

### T1-04 — Extrude with Thickness `[Recipe 4]`

> **Prompt:** Extrude this surface 8 units upward in Z. I want to control the extrusion distance with a slider.

**Expected:** Extrude component, direction = Unit Z (or vector), distance via slider (range ~0 to 20 defaulting around 8).

---

### T1-05 — Pipe Curves `[Recipe 5a]`

> **Prompt:** Take these curves and pipe them with radius 0.25. Make the radius adjustable via slider.

**Expected:** Pipe component, R = slider (~0.1 to 2, default 0.25), C wired from input curves.

---

### T1-06 — Checkerboard Dispatch `[Recipe 6]`

> **Prompt:** I have a list of surface patches. Split them into alternating groups (every other one) and show group A in red and group B in blue using custom preview.

**Expected:** Dispatch with pattern `true;false`, two Custom Preview nodes, two Colour Swatches (red/blue). Intermediates hidden.

---

### T1-07 — Grid Points on Surface `[Recipe 7]`

> **Prompt:** Put a 12×8 grid of points evenly distributed across this surface. Show me the points.

**Expected:** Divide Surface with U=12, V=8, output Pt fed into a preview-capable display (or point param with preview).

---

### T1-08 — Project Points Down `[Recipe 8]`

> **Prompt:** I have some points floating above a surface. Project them straight down (Z direction) onto the surface.

**Expected:** Project Point component, D = Unit Z (or {0,0,-1}), P = input points, G = target surface.

---

### T1-09 — Loft Two Circles `[Recipe 3]`

> **Prompt:** Loft between two circles — one at Z=0 with radius 5, and one at Z=10 with radius 3.

**Expected:** Two Circle components (different radii, different Z heights) → Loft. Should produce a tapered lofted surface.

---

## Tier 2 — Two Recipes Chained

These require the agent to recognize that step A feeds into step B. ~10–18 components.

### T2-01 — Subdivide then Extrude `[Recipe 0+1 → 4]`

> **Prompt:** Create a 25×20 rectangle, split it into a 5×7 grid, and extrude every patch 3 units upward. Show me the result.

**Expected:** Full chain: Rect(25×20) → Divide Domain²(5×7) → Isotrim → Extrude(Z, dist=3) → Custom Preview + Swatch.

---

### T2-02 — Subdivide then Pipe Edges `[Recipe 0+1 → 2 → 5a]`

> **Prompt:** Build a rectangular surface (40×30), divide it into 10×8 patches, extract all the edges, and pipe every edge with radius 0.12.

**Expected:** Rect → Divide → Isotrim → Deconstruct Brep (E output) → Pipe(R=0.12) → Preview.

---

### T2-03 — Checkerboard Facade Panels `[Recipe 0+1 → 6]`

> **Prompt:** Make a 20×15 rectangle, subdivide into 8×6 panels, and color them like a chessboard — white and dark grey, alternating. Use dispatch to split them.

**Expected:** Rect → Divide(8×6) → Isotrim → Dispatch(true;false) → two Custom Previews with white/grey swatches.

---

### T2-04 — Points then Normal Pipes `[Recipe 7 → 5a]`

> **Prompt:** Generate a 10×10 point grid on this surface. At each point, draw a short pipe (length=2, radius=0.08) pointing straight up in Z.

**Expected:** Divide Surface(Pt) → Line SDL(D={0,0,1}, L=2) → Pipe(R=0.08) → Preview. Or Construct Point with offset Z then vertical line.

---

### T2-05 — Loft then Cap to Solid `[Recipe 3 → 4]`

> **Prompt:** Loft between three rectangles: 10×8 at Z=0, 6×4 at Z=10, and 2×2 at Z=20. Then cap it to make a closed solid.

**Expected:** Three Rectangle components (different sizes, Z heights) → Loft → Cap Holes (closed brep output).

---

### T2-06 — Subdivide then Offset Edges `[Recipe 0+1 → 2]`

> **Prompt:** Create a rectangle 30×25, divide into 4×4 patches, get each patch's outer edges, and offset each edge inward by 0.5 units.

**Expected:** Rect → Divide → Isotrim → Deconstruct Brep(E) → Offset Curve(D=-0.5, inside). Note: offset direction can be tricky — agent should use plane input or negative distance.

---

## Tier 3 — Multi-Recipe Compositions

Full workflow builds. These are the real stress tests. ~20–35 components.

### T3-01 — Facade Screen ⭐ `[Recipe 0+1+4+6]`

> **Prompt:** Design a building facade screen. Start with a 50×30 rectangle. Divide it into 12×8 panels. Dispatch them into alternating groups. Extrude group A outward by 5 units (the "projecting" panels). Leave group B flat. Color A white, B dark grey. Show only the final result in preview.

**This is the composition example from the cookbook. Tests end-to-end pattern recognition.**

**Expected:**
```
Rect(50×30) → Divide(12×8) → Isotrim → Dispatch(true;false)
  ├→ A → Extrude(Z, 5) → CustomPreview(white)
  └→ B → CustomPreview(dark grey)
All intermediates hidden. Grouped logically.
```

---

### T3-02 — Structural Grid / Space Frame ⭐ `[Recipe 0+1+2+5a]`

> **Prompt:** Build a glazed roof structure. Start with a 60×40 rectangular plane. Subdivide into 15×10 cells. Extract every cell's edges and pipe them all with radius 0.2 to look like a space frame. Use a metallic-looking colour for preview.

**This is the second composition example from the cookbook.**

**Expected:**
```
Rect(60×40) → Divide(15×10) → Isotrim → Deconstruct Brep(E) → Pipe(R=0.2) → CustomPreview(metallic swatch)
Grouped, clean layout, intermediates hidden.
```

---

### T3-03 — Surface Quill Field ⭐ `[Recipe 0+7+5a]`

> **Prompt:** Create a decorative "quill" field on a 35×25 surface. Populate a 15×12 grid of points on the surface. At each point, grow a thin pipe (radius 0.05, length 3) pointing in the surface normal direction. The result should look like a field of bristles or acoustic baffles.

**This is the third composition example (Surface Studs). Requires Evaluate Surface for normals.**

**Expected:**
```
Rect(35×25) → Divide Surface(U=15,V=12) → Pt + UV
  Pt ──→ Evaluate Surface(S=surface, uv=UV) ──→ N (normals)
  Pt ──→ Line SDL(P=Pt, D=N, L=3) ──→ Pipe(R=0.05) → CustomPreview
```

---

### T3-04 — Parametric Window Wall `[Recipe 0+1+2+4+5a]`

> **Prompt:** Design a curtain wall system. Base surface: 40×25 rectangle. Grid: 8×6 mullions. For each cell:
> - Extract the 4 edges
> - Pipe the edges with R=0.08 (the mullion frames)
> - Extrude the center panel inward by 0.3 (the glass inset)
>
> Show the whole assembly. Mullions in silver, glass in light blue tint.

**Expected:** This combines subdivision, edge extraction, piping, AND extrusion — plus dual-material preview. The agent needs to:
1. Subdivide to get patches
2. Deconstruct Brep for edges → Pipe (mullions)
3. Also feed patches directly → Extrude(inward, 0.3) (glass)
4. Two preview paths with different colours

---

### T3-05 — Stepped Terraces `[Recipe 0+1+4]`

> **Prompt:** Create a stepped terrace form from a 30×30 square. Divide into 5×5 patches. Each row of patches should extrude upward by a different height — row 0 extrudes 1 unit, row 1 extrudes 2, row 2 extrudes 3, etc. (so it looks like stairs going up). Hint: you'll need to map row index to extrusion height.

**Expected:** This tests whether the agent can handle **per-item data** — using something like `List Item`, `Range`, or a script to assign varying heights per row. A challenging data-structure test.

---

### T3-06 — Random Scatter + Project `[Recipe 7+8 → 5a]`

> **Prompt:** Generate 100 random points in a box above the XY plane (Z ranging 10 to 20). Project them all straight down onto a 50×50 rectangular surface below. At each projected point, place a small sphere (radius 0.4). It should look like raindrops landing on a flat plane.

**Expected:**
```
Random points (x,y in ±25, z 10~20) → Project Point(G=surface, D={0,0,-1})
Projected Pt → Sphere(R=0.4) → CustomPreview
```

Tests: random point construction, projection pipeline, geometry creation from points.

---

## Tier 4 — Edge Cases & Ambiguity

These test whether the agent handles underspecified requests gracefully.

### T4-01 — Implicit Starting Surface

> **Prompt:** Subdivide into a 4×4 grid and show me a checkerboard.

**Test:** Agent should realize no surface exists and create one (Recipe 0) first, THEN subdivide (Recipe 1), THEN dispatch (Recipe 6). No error, no "I need a surface" back-and-forth.

---

### T4-02 — Vague Units

> **Prompt:** Make a big rectangle and chop it into lots of small pieces. Pipe all the edges.

**Test:** Agent should pick reasonable defaults (e.g., 50×30 rect, 10×8 grid, R=0.15 pipe) and make everything slider-controlled so the user can adjust. No paralysis from ambiguity.

---

### T4-03 — Contradictory Request

> **Prompt:** Subdivide this curve into a UV grid.

**Test:** Agent should notice a *curve* isn't a surface — either inform the user cleanly OR reasonably interpret (e.g., extrude the curve to a surface first, then subdivide). Should not crash or wire nonsense.

---

### T4-04 — Modify Existing Canvas

> **Prompt:** (Run after T1-02) Now add an extrusion to every subdivided patch. Height = 4, direction = Z.

**Test:** Agent reads existing canvas, identifies the Isotrim output, adds Extrude + slider + wires correctly **without disturbing existing components**.

---

## Prompt Engineering Notes

### Why these prompts work as benchmarks

1. **Progressive depth:** T1 tests single recipes, T2 chains two, T3 builds full compositions, T4 throws curveballs.
2. **Real language:** Prompts are written how a user actually talks ("chop it into pieces", "make it look like raindrops"), not in API-speak.
3. **Cross-cutting concerns:** Every prompt implicitly tests layout discipline, preview hygiene, and the one-call graph workflow — not just component correctness.
4. **Composition overlap:** T3-01/02/03 are literally the cookbook examples — if the agent can't build those, the cookbook isn't working. T3-04/05/06 go beyond to test generalization.

### Running a benchmark session

Compare a baseline commit with the compact-tool-surface commit using the same model, reasoning level, and blank-canvas setup. Randomize prompt order and run each prompt at least five times.

For every run record:

- end-to-end and provider/model duration;
- output and reasoning tokens;
- active schema characters;
- assistant turns and Hopper tool calls;
- tool argument/result characters;
- runtime errors, overlaps, undo behavior, and correctness.

Targets:

- Tier 1–2 new builds normally use one `gh_apply_graph` call and no canvas reread;
- at least 30% fewer median assistant turns;
- at least 25% fewer median output tokens;
- default active Hopper schemas at most 12,000 characters;
- no regression in correctness, runtime messages, overlaps, undo, or surgical edits.

Latency and token targets are reports, not flaky CI gates. Schema budgets and correctness are hard gates.

Before signing off a release, also run these manual Rhino/Grasshopper checks:

- Tier 1, Tier 2, and Tier 3 cookbook definitions;
- an exact plugin-qualified component type;
- C# and Python nodes with custom ports;
- a deliberately invalid mid-graph port, confirming byte-equivalent rollback;
- one Grasshopper Undo after a successful build, confirming the build is restored (standalone applies record one undo step; applies inside a turn share the turn's single undo step — Undo must not require multiple steps and must not duplicate records).

1. **Clear the canvas** (or start fresh).
2. **Paste one randomized prompt.**
3. **Let the agent run to completion and capture the metrics above.**
4. **Score against the checklist** (right components? wiring? layout? preview? atomic graph call?).
5. **Note failures** — which recipe did it miss? Which wiring was wrong? Did it make unnecessary canvas reads or surgical calls?
6. **Repeat** until each selected prompt has at least five runs per comparison commit.

### Expected progression for a well-tuned agent

| Tier | Should pass | Indicates |
|------|------------|----------|
| T1 | 8-9/9 | Individual recipes are documented clearly enough |
| T2 | 5-6/6 | Agent can chain two recipes without confusion |
| T3 | 4-5/6 | Composition patterns are internalized |
| T4 | 3-4/4 | Robustness to ambiguity and canvas state |
