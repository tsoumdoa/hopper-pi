---
name: rhino-document
description: >
  Rhino document and viewport operations: run Rhino commands, Python or C# scripts
  on the active RhinoDoc, layers, selection, blocks, bake, materials. Use when the
  user wants changes in Rhino itself, not Grasshopper canvas wiring.
---

# Rhino Document Expert

## Routing (mandatory)

| Task | Tool |
|------|------|
| Rhino geometry, layers, selection, bake, materials, viewport | `rh_run_script` |
| List Rhino object GUIDs (for GH params) | `rh_query_objects` |
| Get / reference / internalize Rhino geometry on a GH param | `gh_param_rhino` |
| Grasshopper components, wires, sliders, GH script nodes | `gh_*` tools |

If both are needed in one request, use **both**: `rh_run_script` for the document, `gh_*` for the canvas.

## rh_run_script

- **command** — one-liner macros (`_Circle`, `_SelLayer`, …)
- **python** — preferred for scripts using `rhinoscriptsyntax` / `scriptcontext`
- **csharp** — Rhino C# script editor source (Rhino 8)

See [rhino-script-boilerplate.md](../../reference/rhino-script-boilerplate.md).

## Rhino → Grasshopper params

1. `rh_query_objects` (or `rh_run_script` + `print(ids)`) → **Rhino objectId** GUIDs
2. `gh_list_components` with `searchFrom: "params"` → **typeGuid** (e.g. Curve, Point)
3. `gh_edit_components` `add` → **param instance targetId** from `gh_get_canvas`
4. `gh_param_rhino` — `reference`: `new GH_Curve(rhinoId)`; `internalize`: duplicate geometry (`curve.DuplicateCurve()`, etc.). Use `get` to verify (internalized → no `rhino=` on persistent items).

## Examples

**Draw a circle in Rhino (not on GH canvas):**

```json
{ "items": [{ "mode": "python", "source": "import rhinoscriptsyntax as rs\nimport scriptcontext as sc\n\ndoc = sc.doc\nids = rs.AddCircle((0,0,0), 10)\nprint(ids)" }] }
```

**Set current layer:**

```json
{ "items": [{ "mode": "command", "source": "-Layer Current \"Geometry\"" }] }
```

## Never

- Use `gh_edit_script` to run code against `RhinoDoc` — that only edits GH script **components**.
- Use `gh_edit_components` to draw raw Rhino geometry in the viewport.
