# Recipe 0 — Rectangle Surface

**What:** Planar rectangle from plane + U/V domain — standard starting surface.

**Zone Map:** `[Plane][U_slider][V_slider] → [Surface]`

## Pipeline

```
[Plane]      [U: 0→20 slider]       [V: 0→15 slider]
(default XY)   (width / extent)        (height / extent)
    │                 │                       │
    └─────────────────┼───────────────────────┘
                      ▼
                [Surface]
                      │
                      ▼
          → single planar rectangle
```

**Alt — Plane Surface (simpler):**
```
[Plane]     [X: 20 slider]      [Y: 15 slider]
    │               │                  │
    └───────────────┼──────────────────┘
                    ▼
             [Plane Surface]
```

## Output
Single planar rectangular surface.

## Next Steps
→ **Recipe 1** (subdivide), **Recipe 7** (populate points), **Recipe 4** (extrude). Use sliders for parametric resize.
