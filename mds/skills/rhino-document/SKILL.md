---
name: rhino-document
description: >
  Rhino document and viewport operations: run Rhino commands, Python or C# scripts
  on the active RhinoDoc, layers, selection, blocks, bake, materials. Use when the
  user wants changes in Rhino itself, not Grasshopper canvas wiring.
---

# Rhino Document Expert

## Reference layout

Shared reference docs live at `mds/reference/` (not under this skill).
- Full path example: `mds/reference/rhino-script-boilerplate.md`
- Also reachable via: `mds/skills/rhino-document/reference/` (symlink)

## Routing (mandatory)

| Task | Tool |
|------|------|
| Rhino geometry, layers, selection, bake, materials | `rh_run_script` |
| Rhino viewport/camera changes | `rh_view_control` preferred; `rh_run_script` for advanced one-offs |
| Optional visual QA / viewport screenshot context | `rh_capture_view` only after permission is granted |
| List Rhino object GUIDs (for GH params) | `rh_query_objects` |
| Get / reference / internalize Rhino geometry on a GH param | `gh_param_rhino` |
| Grasshopper components, wires, sliders, GH script nodes | `gh_*` tools |

If both are needed in one request, use **both**: `rh_run_script` for the document, `gh_*` for the canvas.

When the prompt is vague about Rhino vs Grasshopper scope (e.g. "fix the model", "clean this up"), use `pick_option` to ask whether to focus on the Rhino document, Grasshopper canvas, both, or current selection — **before** editing. An "Other" option is always shown for custom answers; do not add it to the options list.

## Visual context and viewport control

- `rh_capture_view` is optional and permission-gated per Pi session. If capture was not allowed, continue with text and geometry context.
- Use visual capture for visual QA, composition, object visibility, display mode/material checks, or ambiguous viewport tasks where pixels materially help.
- Use `rh_view_control` before capture when you need a standard view, existing named view, CPlane-aligned plan view, camera/target/lens change, or zoom.
- Prefer non-persistent view changes. Only use `rh_view_control` `saveNamedView` when the user explicitly asked to create/update a named view.
- Default workflow should still work without visual capture: query objects, inspect Grasshopper canvas/errors, and use `rh_run_script` to print structured RhinoDoc context.

## rh_run_script

- **command** — one-liner macros (`_Circle`, `_SelLayer`, …)
- **python** — preferred for scripts using `rhinoscriptsyntax` / `scriptcontext`; use `print()` for return values
- **csharp** — Rhino C# script editor body (Rhino 8 RhinoCode); use `Console.WriteLine()` like Python's `print()`

Both script modes run via RhinoCode and return captured stdout to the agent.

**Do not** call `doc.Objects.GetObjectList()` with no args in Rhino 8 — use `rh_query_objects`, `rs.ObjectsByType(...)`, or `GetObjectList(ObjectType.AnyObject)`.

See [rhino-script-boilerplate.md](../../reference/rhino-script-boilerplate.md) — path: `mds/reference/rhino-script-boilerplate.md`

## Rhino → Grasshopper params

1. `rh_query_objects` → **short Rhino objectId** aliases (4–10 chars), or `countOnly: true` to check how many match
2. `gh_list_components` with `searchFrom: "params"` → **typeGuid** (e.g. Curve, Point)
3. `gh_edit_components` `add` → **param instance targetId** from `gh_get_canvas`
4. `gh_param_rhino`:
   - **Few objects (≤30):** `rhinoObjectIds` with short IDs from step 1
   - **Whole layer / large sets:** `rhinoQuery: { layer, objectType?, selectionOnly? }` — no ID list in the agent turn (required above 30 objects)
   - `reference` keeps live Rhino links; `internalize` copies geometry. Use `get` to verify (internalized → no `rhino=` on persistent items).
   - Before **internalize** on >10 objects or a whole layer (`rhinoQuery`), see [gh-modeling-expert: User clarification tools](../gh-modeling-expert/SKILL.md#user-clarification-tools).

**Bulk layer example:**

```json
{
  "items": [{
    "action": "reference",
    "targetId": "a1b2",
    "rhinoQuery": { "layer": "Geometry::Walls", "objectType": "curve" }
  }]
}
```

## Examples

**Draw a circle in Rhino (not on GH canvas):**

```json
{ "items": [{ "mode": "python", "source": "import rhinoscriptsyntax as rs\nimport scriptcontext as sc\n\ndoc = sc.doc\nids = rs.AddCircle((0,0,0), 10)\nprint(ids)" }] }
```

**Set current layer:**

```json
{ "items": [{ "mode": "command", "source": "-Layer Current \"Geometry\"" }] }
```

**Draw a circle in C# (same stdout contract as Python `print`):**

```json
{ "items": [{ "mode": "csharp", "source": "using Rhino;\nusing Rhino.Geometry;\n\nvar doc = RhinoDoc.ActiveDoc;\nvar id = doc.Objects.AddCircle(new Circle(Point3d.Origin, 10));\ndoc.Views.Redraw();\nConsole.WriteLine(id);" }] }
```

## Never

- Use `gh_edit_script` to run code against `RhinoDoc` — that only edits GH script **components**.
- Use `gh_edit_components` to draw raw Rhino geometry in the viewport.
