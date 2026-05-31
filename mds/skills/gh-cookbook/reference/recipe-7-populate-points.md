# Recipe 7 — Populate Points on Surface

**What:** Grid or random point distribution across a surface, with UV coordinates.

**Zone Map:** `[Surface][U_slider][V_slider] → [Divide Surface]`

## Pipeline (Grid)

```
[Surface]        [U: 10 slider]       [V: 10 slider]
 (target)      (points in U)          (points in V)
    │                 │                    │
    ├─────────────────┤                    │
    │                 ▼                    │
    │         [Divide Surface] ◄───────────┘
    │              │    │
    │             Pt   UV
    │              │    │
    ▼              ▼    ▼
  list of     {x,y,z}  {u,v}
  points      points   coords
```

## Pipeline (Random)

```
[Surface]        [Count: slider]        [Seed: slider]
 (target)       (how many)           (variation)
    │                 │                   │
    └─────────────────┼───────────────────┘
                      ▼
               [Populate Geometry]
                     │
                     P
                     ▼
            → random points on surface
```

## Output
**Grid:** 3D points + matching UV coords · **Random:** scattered points on surface.

## Next Steps
→ **Evaluate Surface** for normals/tangents at each point · **Circle** + **Recipe 4** extrude for bolts/studs · **Line SDL** + **Recipe 5a** pipe for bristles/quills
