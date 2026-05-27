# Recipe 4 — Extrude

**What:** Linear extrusion of curves or surfaces along a direction vector.

**Zone Map:** `[Geometry][Dist_slider] → [Extrude]`

## Pipeline

```
[Geometry]        [Dist: 0→50 slider]
(curve/surface)     (extrusion distance)
    │                     │
    │    [Unit Z] ──→ [Amplitude] ─┘
    │                           │
    └───────────────────────────┤
                                ▼
                           [Extrude]
                                │
                                ▼
              → extruded surface (curve) or polysurface (surface)
```

**Shortcut for simple Z-extrude:**
```
[Geometry] ──→ [Extrude].B
[Unit Z]   ──→ [Extrude].D   (distance via Amplitude on vector)
```

## Output
Extruded surface or polysurface.

## Next Steps
→ After **Recipe 1**: extrude each patch at different heights (facade screen) · **Cap Holes** for solids · Boolean ops (**Solid Difference**, **Union**)
