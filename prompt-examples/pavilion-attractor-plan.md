# Build Plan — Parametric Attractor Pavilion (20 m × 12 m)

> **Recipe for an executing agent.** Follow top-to-bottom. Everything needed is here:
> design intent, exact components with typeGuids, canvas positions, slider specs,
> wiring table by port *name*, data-tree handling, and QA steps. No extra research needed.

---

## 1. Design concept (what you are building)

A rectangular canopy **20 m × 12 m**, raised **3.5 m** above the ground plane,
subdivided into a **12 × 8 grid of panels**. Each panel is folded up into a
**4-sided pyramid ("diamond" facet)** whose apex height is driven by an
**attractor point**: panels *near* the attractor peak highest (warm color),
panels far away stay nearly flat (cool color). Naked panel edges are **piped**
to form a structural grid frame under the canopy.

Creative signature: faceted diamond canopy + inverted-distance height mapping +
attractor-driven HSV color gradient + piped structural frame. All fully parametric.

```
side view (through attractor):        top view (heights as shade):

      /\  /\                          ░ ░ ▒ ▓ █ ▓ ▒ ░
   /\/  \/  \/\                       ░ ▒ ▓ █ █ █ ▓ ░      █ = tall, near attractor
__/____________\__  ← canopy 3.5 m    ░ ░ ▒ ▓ ▓ ▓ ▒ ░
```

---

## 2. Assumptions & units

- **Assumed Rhino doc units = meters.** All slider values below are in meters.
- **If the doc is in millimeters**, multiply every length slider (Width, Depth,
  Elev, AttrX/Y/Z, MinH, MaxH, PipeR) and its min/max by **1000**. Counts, hues,
  sat/val are unit-free.
- Complexity: **Tier 3** (~30 components). Workflow: place everything zone by zone
  → **one** `gh_get_canvas` call → wire everything → `gh_get_canvas_errors` → fix.
- All components placed with `preview: false` **except** the two Custom Preview
  components at the end.

---

## 3. Widgets (create with `gh_create_widget`)

All sliders in the params zone, x = 100, stacked with 30 px vertical spacing.

| # | Widget | nickName | x | y | min | max | value | digits |
|---|--------|----------|---|---|-----|-----|-------|--------|
| S1 | slider | Width | 100 | 100 | 5 | 40 | **20** | 1 |
| S2 | slider | Depth | 100 | 130 | 5 | 40 | **12** | 1 |
| S3 | slider | U-Count | 100 | 160 | 2 | 30 | **12** | 0 |
| S4 | slider | V-Count | 100 | 190 | 2 | 30 | **8** | 0 |
| S5 | slider | CanopyElev | 100 | 220 | 0 | 8 | **3.5** | 1 |
| S6 | slider | AttrX | 100 | 250 | -5 | 25 | **14** | 1 |
| S7 | slider | AttrY | 100 | 280 | -5 | 17 | **6** | 1 |
| S8 | slider | AttrZ | 100 | 310 | 0 | 10 | **3.5** | 1 |
| S9 | slider | MinPeak | 100 | 340 | 0.05 | 1 | **0.25** | 2 |
| S10 | slider | MaxPeak | 100 | 370 | 0.5 | 5 | **2.2** | 2 |
| S11 | slider | HueNear | 100 | 400 | 0 | 1 | **0.02** | 2 |
| S12 | slider | HueFar | 100 | 430 | 0 | 1 | **0.62** | 2 |
| S13 | slider | Sat | 100 | 460 | 0 | 1 | **0.75** | 2 |
| S14 | slider | Val | 100 | 490 | 0 | 1 | **0.95** | 2 |
| S15 | slider | PipeRadius | 100 | 520 | 0.01 | 0.3 | **0.06** | 2 |
| W1 | toggle | Wrap | 1000 | 230 | — | — | **true** | — |
| W2 | swatch | PipeColor | 2110 | 540 | — | — | rgba(70,70,75,255) | — |

---

## 4. Components (create with `gh_edit_components`, action `add`)

typeGuids are the short aliases returned by `gh_list_components` — use them verbatim.

| # | Component | typeGuid | nickName | x | y | preview |
|---|-----------|----------|----------|------|-----|---------|
| C1 | Construct Point | `pgoj` | CanopyOrigin | 320 | 200 | false |
| C2 | Construct Point | `pgoj` | Attractor | 320 | 320 | false |
| C3 | XY Plane | `dhlO` | CanopyPlane | 460 | 200 | false |
| C4 | Plane Surface | `uHta` | BaseSrf | 590 | 170 | false |
| C5 | Divide Domain² | `oI39` | GridDomains | 730 | 140 | false |
| C6 | Isotrim | `aylD` | Panels | 860 | 190 | false |
| C7 | Area | `AcWs` | PanelCenters | 1000 | 130 | false |
| C8 | Deconstruct Brep | `doAU` | PanelCorners | 1000 | 300 | false |
| C9 | Shift List | `QWtA` | CornersShift | 1150 | 300 | false |
| C10 | Distance | `Rcwc` | AttrDist | 1150 | 420 | false |
| C11 | Bounds | `iMmL` | DistBounds | 1150 | 500 | false |
| C12 | Construct Domain | `D4U1` | PeakDomain | 1150 | 570 | false |
| C13 | Construct Domain | `D4U1` | HueDomain | 1150 | 650 | false |
| C14 | Remap Numbers | `j4g5` | PeakHeights | 1300 | 440 | false |
| C15 | Remap Numbers | `j4g5` | HueValues | 1300 | 600 | false |
| C16 | Unit Z | `I8dX` | LiftVec | 1440 | 440 | false |
| C17 | Move | `8uGk` | Apexes | 1560 | 340 | false |
| C18 | Graft Tree | `Q4un` | ApexGraft | 1680 | 380 | false |
| C19 | 4Point Surface | `uWmz` | Facets | 1800 | 300 | false |
| C20 | Brep Join | `pzCH` | Pyramids | 1930 | 300 | false |
| C21 | Flatten Tree | `Saf0` | PyramidsFlat | 2050 | 250 | false |
| C22 | Colour HSV | `ivky` | PanelColor | 1560 | 600 | false |
| C23 | Brep Edges | `lEOD` | FrameEdges | 2050 | 420 | false |
| C24 | Pipe | `Obzx` | FramePipes | 2180 | 420 | false |
| C25 | Custom Preview | `FA3i` | ShellPreview | 2300 | 260 | **true** |
| C26 | Custom Preview | `FA3i` | FramePreview | 2300 | 440 | **true** |

---

## 5. Wiring (after ONE `gh_get_canvas` to resolve instance + port GUIDs)

Match ports **by name** (letter shown is the standard GH port nickname).
Batch independent wires in single `gh_edit_wire` calls.

### Base & grid
| From | To |
|------|----|
| S5 CanopyElev → | C1 CanopyOrigin **Z** (leave X, Y at default 0) |
| C1 **Pt** → | C3 CanopyPlane **O** (origin) |
| C3 **P** → | C4 BaseSrf **P** (plane) |
| S1 Width → | C4 BaseSrf **X** (x size; number auto-casts to domain 0→20) |
| S2 Depth → | C4 BaseSrf **Y** |
| C4 **P** (surface out) → | C5 GridDomains **I** |
| S3 U-Count → | C5 **U** |
| S4 V-Count → | C5 **V** |
| C4 **P** (surface out) → | C6 Panels **S** |
| C5 **S** (segments) → | C6 Panels **D** |

### Attractor field
| From | To |
|------|----|
| S6 AttrX → C2 **X** · S7 AttrY → C2 **Y** · S8 AttrZ → C2 **Z** | |
| C6 **S** (panels) → | C7 PanelCenters **G** |
| C7 **C** (centroids) → | C10 AttrDist **A** |
| C2 **Pt** → | C10 AttrDist **B** |
| C10 **D** → | C11 DistBounds **N** |
| **S10 MaxPeak → C12 PeakDomain A** (start = max ⇒ inverted mapping: near = tall) | |
| **S9 MinPeak → C12 PeakDomain B** | |
| C10 **D** → C14 PeakHeights **V** · C11 **I** → C14 **S** · C12 **I** → C14 **T** | |
| S11 HueNear → C13 HueDomain **A** · S12 HueFar → C13 **B** | |
| C10 **D** → C15 HueValues **V** · C11 **I** → C15 **S** · C13 **I** → C15 **T** | |

### Pyramid panels
| From | To |
|------|----|
| C6 **S** (panels) → | C8 PanelCorners **B** |
| C8 **V** (vertices) → | C9 CornersShift **L** |
| W1 Wrap (true) → | C9 **W** (leave shift S at default 1) |
| C14 **R** (heights) → | C16 LiftVec **F** (factor) |
| C7 **C** (centroids) → | C17 Apexes **G** |
| C16 **V** (vector) → | C17 Apexes **T** (motion) |
| C17 **G** (moved) → | C18 ApexGraft **T** |
| C8 **V** → C19 Facets **A** · C9 **L** → C19 **B** · C18 **T** → C19 **C** — **leave D unwired** (3-point = triangle) | |
| C19 **S** → | C20 Pyramids **B** |

### Display & structure
| From | To |
|------|----|
| C20 **B** → | C21 PyramidsFlat **T** |
| C15 **R** (hues) → C22 PanelColor **H** · S13 Sat → C22 **S** · S14 Val → C22 **V** (if an Alpha input **A** exists, leave default) | |
| C21 **T** → C25 ShellPreview **G** · C22 **C** → C25 **M** | |
| C20 **B** → | C23 FrameEdges **B** |
| C23 **En** (naked edges = panel base frame) → | C24 FramePipes **C** |
| S15 PipeRadius → | C24 **R** (leave caps E default) |
| C24 **P** → C26 FramePreview **G** · W2 PipeColor → C26 **M** | |

---

## 6. Data-tree logic (why it works — do not skip components)

- `Isotrim` outputs a **flat list** of U×V panels (96 with defaults).
- `Deconstruct Brep` per panel → vertices tree `{0;i}` with **4 corner points** per branch.
- `Shift List` (shift 1, wrap **true**) pairs each corner with the next → 4 edges/branch.
- Apexes are a flat list (one per panel); **Graft Tree (C18)** converts to `{0;i}`
  with 1 item per branch so longest-list matching replicates the apex across the
  4 corner pairs → `4Point Surface` emits **4 triangles per panel**; D unwired = triangles.
- `Brep Join` per branch fuses the 4 triangles into one pyramid shell.
- **Flatten Tree (C21)** makes pyramids a flat list of length U×V so the flat color
  list from `Colour HSV` pairs one-to-one in Custom Preview.
- Graft/flatten are done with dedicated components on purpose: `gh_edit_param`
  cannot set dataMapping on standard (non-script) components.

---

## 7. Build order for the executing agent

1. Create all widgets (§3) — batch in 1–2 `gh_create_widget` calls.
2. Add all components (§4) — batch `gh_edit_components` calls, `preview: false`
   except C25/C26.
3. **One** `gh_get_canvas` (unfiltered) to collect instance + port GUIDs.
4. Wire everything (§5) — batch independent wires.
5. `gh_get_canvas_errors` → fix any issues (see §9).
6. Group zones with `gh_edit_group`:
   - "01 Params" (S1–S15) — rgba(220,230,245,120)
   - "02 Base+Grid" (C1,C3–C6) — rgba(210,240,215,120)
   - "03 Attractor Field" (C2,C7,C10–C15) — rgba(250,235,205,120)
   - "04 Pyramid Panels" (C8,C9,W1,C16–C21) — rgba(235,220,245,120)
   - "05 Display+Frame" (C22–C26,W2) — rgba(245,215,215,120)
7. Optional visual QA: `rh_view_control` perspective + zoom extents, then
   `rh_capture_view` (if consent allows).

---

## 8. Expected result / acceptance checks

- Panel count = U × V = **96** pyramids (open shells, 4 triangular faces each).
- Canopy footprint 20 × 12 at z = 3.5; apexes between z ≈ 3.75 and z ≈ 5.7.
- Tallest, red-ish pyramids cluster around (14, 6, 3.5); flattest, blue-ish at far corners.
- Pipes trace the rectangular panel-grid frame at canopy level.
- Moving AttrX/AttrY sliders visibly migrates the peak zone. No red components.

## 9. Known pitfalls & fixes

| Symptom | Fix |
|---------|-----|
| 4Point Surface makes quads not triangles | Ensure input **D** has no wire. |
| Apex not matching per panel (1 pyramid only / wrong lofting) | Confirm C18 Graft Tree sits between C17 and C19; C8 **V** (not C8 F/E) feeds A. |
| Colors don't vary per panel | Confirm C21 Flatten between C20 and C25; colors and breps must both be flat lists of 96. |
| Corners pair with wrong neighbor (bowtie facets) | Wrap toggle must be **true** on C9. |
| Plane Surface size wrong (domain −10→10) | Wire sliders to X/Y as plain numbers; they cast to 0→N domains. If a centered surface appears, replace with Construct Domain (0→Width) feeding X. |
| Heights inverted (far panels tall) | C12 must receive **MaxPeak into A, MinPeak into B** (intentional inversion). |

## 10. Optional extensions (only if user asks later)

- **Columns:** Cull the 4 corner panels' centroids (or use Isotrim corner patches),
  drop lines from panel base to z=0, pipe at r=0.12 → entry columns.
- **Ground slab:** second Plane Surface at z=0, same Width/Depth, extrude −0.15.
- **Bake:** follow cookbook Recipe 9 (`mds/skills/gh-cookbook/reference/recipe-9-bake-geometry.md`)
  — Model Object + Model Layer pipeline for pyramids ("Pavilion::Shell") and pipes
  ("Pavilion::Frame").
