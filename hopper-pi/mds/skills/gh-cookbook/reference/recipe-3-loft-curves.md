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

### ⚠️ Data Matching Heuristic — Flatten when sources differ

When profile curves come from **different components** (e.g. original curve + offset curve, or edge extraction + drawn curve), each source produces its own data-tree branch. Loft receives **N separate lists** instead of **one list of N curves** → loft fails or produces garbage.

**Fix:** Set `Loft.C` access to **Flatten** (right-click input → **Flatten**). This merges all branches into a single flat list so Loft sees every profile in sequence.

```
# Before (broken) — two branches:
Loft.C = { 0;0 } [Circle]          ← branch 0
         { 0;1 } [Offset result]   ← branch 1

# After (fixed) — flattened:
Loft.C = { Circle, Offset_result }  ← one list, two curves
```

**Rule of thumb:** If your profiles are wired from **≥2 different components**, **flatten the Loft `C` input**. If all curves come from a single source (e.g. one Divide/Isotrim output), leave it as default (**Item** / **List**) to preserve structure.

## Output
A lofted surface through all profiles.

## Next Steps
→ **Cap Holes** for solid brep · **Recipe 4** extrude for thickness · **Split** with cutting geometry
