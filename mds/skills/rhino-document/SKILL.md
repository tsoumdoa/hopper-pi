---
name: rhino-document
description: Rhino document and viewport workflow for geometry, layers, selection, blocks, direct baking, materials, object queries, and visual QA. Use for changes in the active RhinoDoc; use gh-modeling-expert for Grasshopper canvas wiring.
---

# Rhino Document Expert

## Route first

| Outcome | Tool |
|---------|------|
| Change Rhino geometry, layers, selection, blocks, materials, or directly commit current geometry | `rh_run_script` |
| Change viewport, projection, camera, CPlane view, or zoom | `rh_view_control` |
| Inspect pixels for visual QA | `rh_capture_view` when available |
| List/count Rhino objects or obtain short IDs | `rh_query_objects` |
| Reference/internalize Rhino objects on a GH geometry param | `gh_param_rhino` |
| Build a reusable parametric bake pipeline in the GH definition | `gh_*` + [Cookbook Recipe 9](../gh-cookbook/reference/recipe-9-bake-geometry.md) |
| Edit GH components, wires, widgets, or script nodes | `gh_*` |

When one request crosses Rhino and Grasshopper, use both tool families. Ask only when the boundary changes the requested outcome, risks data loss, or could edit the wrong target. In particular, ambiguous “bake” means:

- **Direct/current bake to Rhino:** `rh_run_script`.
- **Reusable GH bake pipeline:** Recipe 9.

## Rhino document scripts

`rh_run_script` modes:

- `command` — short Rhino macros.
- `python` — preferred for multi-step `rhinoscriptsyntax` / `scriptcontext` work.
- `csharp` — Rhino 8 RhinoCode script-editor body.

Use `print()` in Python or `Console.WriteLine()` in C# for values the agent must read. Do not call `doc.Objects.GetObjectList()` without arguments in Rhino 8. Templates and supported alternatives → [rhino-script-boilerplate.md](../../reference/rhino-script-boilerplate.md).

## View and visual QA

- Prefer `rh_view_control` over scripts for normal view changes. Save a named view only when explicitly requested.
- For a one-off standard or named-view screenshot, pass `view` to `rh_capture_view`; `restoreView` defaults to true. Use `rh_view_control` first only for custom camera/CPlane setup or a persistent view change.
- Screenshots are optional and model-dependent. If unavailable, continue with object queries, canvas/errors, and scripts.

## Rhino → Grasshopper geometry params

1. Use `rh_query_objects` to filter/count objects and obtain short IDs when the set is small.
2. Create the correct GH geometry param with `gh_apply_graph` (use `gh_list_components` with `searchFrom: "params"` only if its type is uncertain).
3. Use the short ID returned for that local ref as `targetId`; no canvas reread is required.
4. Call `gh_param_rhino` with exactly one source:
   - `rhinoObjectIds` for up to 30 objects.
   - `rhinoQuery` for a layer/selection/type bulk set.
5. `reference` keeps live Rhino links; `internalize` stores copies. Use `get` to verify.

Before internalizing more than 10 objects or a whole layer, confirm reference vs internalize with `pick_option`.

## Never

- Use `gh_edit_script` to run against `RhinoDoc`; it edits code inside a GH script component.
- Use `gh_edit_components` to draw raw Rhino geometry.
- Use `rh_run_script` for ordinary viewport/camera changes when `rh_view_control` supports them.
