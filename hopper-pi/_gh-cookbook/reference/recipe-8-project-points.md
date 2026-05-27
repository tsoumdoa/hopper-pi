# Recipe 8 — Project Points

**What:** Ray-cast points onto a surface/brep along a direction vector (usually Z-down).

**Zone Map:** `[Points][Geometry] → [Project Point]`

## Pipeline

```
[Points]          [Geometry]          [Direction / Unit Z]
(source)          (target surface)      (ray direction)
    │                  │                    │
    └──────────────────┼────────────────────┘
                       ▼
                [Project Point]
                     │   │
                     P   I
                     │   │
                     ▼   ▼
              projected  index of face
              on surface  hit (-1 = miss)
```

## Output
3D points lying on the target geometry surface(s).

## Next Steps
→ After **Recipe 7**: generate points above → project onto wavy surface for terrain-following · **Pull Point** for closest-point params · **Evaluate Surface** for normal-aligned objects on complex surfaces
