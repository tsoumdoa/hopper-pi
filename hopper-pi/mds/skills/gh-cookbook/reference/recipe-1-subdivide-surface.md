# Recipe 1 — Subdivide Surface

**What:** Split a surface into a U×V grid of subsurface patches.

**Zone Map:** `[Surface][U_panel][V_panel] → [Divide] → [Isotrim]`

## Pipeline

```
[Surface]     [U: 5 panel]       [V: 8 panel]
 (input)     (segments U)        (segments V)
    │               │                  │
    ├───────────────┤                  │
    │               ▼                  │
    │         [Divide Domain²]         │
    │               │                  │
    │               S ─────────────────┘
    │               ▼
    │         [Isotrim / SubSrf]
    │               │
    └───────────────┘
                    ▼
      → list of U×V surface patches (e.g. 40)
```

## Output
List of `U × V` subsurfaces.

## Next Steps
→ **Recipe 4** extrude for thickness/fins · **Recipe 6** dispatch for checkerboard · **Recipe 2** extract edges per patch → **Recipe 5a** pipe
