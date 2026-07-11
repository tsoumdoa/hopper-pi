# Recipe 3 — Loft Between Curves

**What:** Lofted surface through two or more profile curves.

**Zone Map:** `[Curve_1][Curve_2][Curve_3] → [Loft]`

## Pipeline

```
[Curve_1]     [Curve_2]     [Curve_3]
 (profile)     (profile)      (profile)
    │             │              │
    └─────────────┼──────────────┘
                  ▼
               [Loft]
                  │
                  ▼
          → lofted surface
```

**Tips:** Curves must be in order (**Shift List** to fix). All should point same direction — **Flip Curve** if twisted. Closed profiles → solid-like brep.

### Data matching

Choose tree handling from the intended loft sets, not from the number of upstream components:

- **One loft through all profiles:** flatten `Loft.C` only when the incoming tree separates curves that should form one ordered list.
- **One loft per profile set:** preserve or graft branches so each branch contains one complete ordered set.

Inspect the incoming structure when unsure; unconditional flattening can merge independent lofts.

## Output
A lofted surface through all profiles.

## Next Steps
→ **Cap Holes** for solid brep · **Recipe 4** extrude for thickness · **Split** with cutting geometry
