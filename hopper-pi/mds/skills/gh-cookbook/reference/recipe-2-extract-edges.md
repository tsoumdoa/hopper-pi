# Recipe 2 — Extract Edges

**What:** Get edge curves from a surface/brep, organized by type.

**Zone Map:** `[Surface/Brep] → [Deconstruct Brep]`

## Pipeline

```
[Surface / Brep]
       │
       ▼
[Deconstruct Brep]
       │
       ├── F → faces (surfaces)
       ├── E → all edge curves (flat list)
       └── V → vertices
```

**Alt — Brep Edges (cleaner for edge-only):**
```
[Surface / Brep]
       │
       ▼
  [Brep Edges]
       │
       ├── E → exterior (outer boundary) edges
       └── I → interior (hole/trim loop) edges
```

## Output
Edge curves (flat list or split by type).

## Next Steps
→ **Recipe 5a** pipe for wireframe/frames · **Offset** edges inward for inset panels · **Loft** offset ↔ original for raised borders · After **Recipe 1**: per-patch edge extraction
