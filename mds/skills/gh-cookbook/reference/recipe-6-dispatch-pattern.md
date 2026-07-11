# Recipe 6 — Dispatch / Pattern

**What:** Split a list into A/B outputs using a boolean pattern — checkerboards, alternation, skip-N.

**Zone Map:**
```
[List_in][Pattern] → [Dispatch] ──→ [Swatch_A][Preview_A]
                                   └─→ [Swatch_B][Preview_B]
```

## Pipeline

```
[Input List]        [Pattern panel: oneItemPerLine]
(e.g. SubSrf.S)          true
                         false
       │                     │
       └─────────────────────┤
                             ▼
                        [Dispatch]
                          │    │
              ┌───────────┘    └───────────┐
              ▼                           ▼
      (items where true)           (items where false)
              │                           │
              ▼                           ▼
     [Swatch: colour]  → [CustomPreview]   [Swatch: colour]  → [CustomPreview]
          (A)                              (B)
```

Set the Panel's `textOutput` to `oneItemPerLine`; put one Boolean on each line. Common repeating lists: `true`/`false` = ABAB · `true`/`true`/`false`/`false` = AABB · `true`/`false`/`false`/`false` = every fourth item in A.

## Output
Two lists partitioned by the pattern.

## Next Steps
→ Two **Custom Preview** nodes with different swatches = checkerboard facade · **Recipe 4** extrude only group A for projecting panels · **Cull Index** / **Cull N** for simpler removal patterns
