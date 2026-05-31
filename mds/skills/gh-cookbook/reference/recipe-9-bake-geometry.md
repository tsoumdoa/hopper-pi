# Recipe 9 — Bake Geometry

**What:** Bakes Grasshopper geometry into the Rhino document on a named, colored layer using Model Object + Model Layer (Rhino 8+).

**Zone Map:** `[Layer_Panel][Color_Swatch] → [Model Layer] → [Model Object] ← [Geometry] → [Cache]`

## Components

| Step | Component | Config | Notes |
|------|-----------|--------|-------|
| 1 | **Panel** | Layer name as text (e.g. `"2D::Outline"`) | Nested layer names use `::` separator |
| 2 | **Swatch** | Pick desired layer color | Drives the baked layer's display color |
| 3 | **Model Layer** | default | Takes name (Panel) + color (Swatch) → layer definition |
| 4 | **Geometry** | Right-click → set geometry type | Curve, Brep, Mesh — whatever you want to bake |
| 5 | **Model Object** | default | Takes geometry + layer → baked model object in Rhino |
| 6 | **Content Cache** | default | Caches the baked result so it persists across solves |

## Wiring

```
[Panel]          [Swatch]
"2D::Outline"     (color)
  │                 │
  ├─→ [Model Layer].N
  │     [Model Layer].Dc ←─┘
  │           │
  │       (layer def)
  │           │
  │     [Model Object].L ←───┘
  │
[Geometry] ──→ [Model Object].G
                  │
              (model object)
                  │
                  ▼
             [Content Cache]
```

## Output
Baked Rhino objects on the specified layer. The Content Cache ensures the geometry persists in the Rhino document without re-triggering a full solve.

## Typical Next Steps
→ After any modeling recipe (0–8): swap a preview endpoint for this bake pipeline to commit geometry to the Rhino document · Change the Panel text to organize baked output into separate layers (e.g. `"Structure"`, `"Facade"`, `"Mesh"`) · Combine with **Recipe 6 (Dispatch)** to bake two subsets to different layers.
