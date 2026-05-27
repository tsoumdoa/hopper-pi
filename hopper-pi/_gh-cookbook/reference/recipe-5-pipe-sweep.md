# Recipe 5 — Pipe / Sweep

**What:** Tubular radius around curves (pipe) or custom section swept along a rail.

**Zone Map:**
- **5a:** `[Curves][R_slider] → [Pipe]`
- **5b:** `[Section][Rail] → [Sweep1]`

## Pipeline (5a — Simple Pipe)

```
[Curves]          [R: 0.1→5 slider]
(rail curves)        (pipe radius)
    │                     │
    └─────────────────────┤
                          ▼
                       [Pipe]
                          │
                          ▼
              → closed brep pipes per curve
```

## Pipeline (5b — Custom Sweep)

```
[Section]          [Rail]
(cross-section)    (path curve)
    │                  │
    └──────────────────┤
                       ▼
                   [Sweep1]
                       │
                       ▼
            → swept surface/brep
```

## Output
**5a:** Closed brep pipes · **5b:** Swept surface/brep.

## Next Steps
→ After **Recipe 2**: pipe edges for structural framing · After **Recipe 1+2**: piped grid/mesh look · Sweep L-channels, T-beams for architectural detailing
