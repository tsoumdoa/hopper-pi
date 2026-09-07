---
name: gh-modeling-expert
description: Create, edit, debug, and organize Grasshopper definitions and C#/Python components. Use for GH canvas work; load gh-cookbook only for a matching recipe.
---

# Grasshopper modeling

## Workflow

Use task-specific tools and APIs. Verify unfamiliar component types, ports, and script methods against schemas, current component information, or API documentation.

- For a new subgraph, resolve unusual or ambiguous types with `gh_list_components`, then submit nodes, wires, and groups together in `gh_apply_graph`. Use local refs and the returned short IDs; no canvas read is needed just to recover new IDs.
- For existing work, inspect the relevant selection or subgraph first. Make targeted edits using current IDs. `gh_apply_graph` wires connect only nodes created in that call; connect existing nodes with `gh_edit_wire`.
- Inspect integrated runtime messages and overlaps after building. Repair using returned IDs; use `gh_get_canvas_errors` for existing nodes. A timeout leaves the canvas outcome uncertain, so inspect before retrying.
- Limit cleanup to touched components. Remove unused additions, fix errors and overlaps, and verify the requested geometry and data structure.

Use [rhino-document](../rhino-document/SKILL.md) for Rhino model edits and direct baking, including its saved-script policy. Use [Recipe 9](../gh-cookbook/reference/recipe-9-bake-geometry.md) for a reusable GH bake pipeline and `rh_view_control` for views. `gh_edit_script` edits GH components, not Rhino document scripts.

## Modeling and layout

- Read `gh_document` with `action: "getSettings"` before dimensional work. Convert physical sizes to the effective Rhino model units; do not assume millimeters. Check the settings source, revision, and context mismatch. Refresh after document/settings changes. Keep model/layout and angle units distinct; explicit component tolerances take precedence.
- Prefer Breps unless requested otherwise. Prefer extrude, pipe, sweep, or loft when they avoid unnecessary booleans. Check closure when solids are requested; extruding a curve or lofting closed profiles does not guarantee a solid.
- Prefer C# for geometry scripts and Python for simple list/tree utilities. Respect the user's language choice. Keep GH scripts safe for repeated recomputation.
- Arrange inputs, processing, and outputs left to right without cyclic wiring. Do not edit components in negative canvas space. Group by function when useful.
- Use gaps of 50px between zones, 30px within tightly coupled pairs, and 40px vertically, measured from bounds. For large or branching graphs, plan all zones before submission. See [layout reference](../../reference/layout-system.md) for sizes and pivot offsets.
- Hide intermediate previews. Show final output through Custom Preview with a Colour Swatch; add Create Material only for properties beyond diffuse color. Size panels to their content and choose `textOutput` for the intended data shape.

## Clarification

Proceed with reasonable defaults for layout, slider ranges, and routine implementation. Ask when unresolved scope, target identity, data loss, or alternatives would materially change the result. Honor choices already made, including reference versus internalize.

Use `pick_option` for 2–6 informed choices, with `typeGuid` or `targetId` values when selecting components. It adds Other automatically. Use `ask_user` for free text. Bundle the consequential questions; do not ask the user to choose an internal complexity tier.

## References

Load only what the current task needs.

| Need | Reference |
|------|-----------|
| New-subgraph schema, validation, rollback | [apply-graph.md](../../reference/apply-graph.md) |
| Bounds, sizes, preview placement | [layout-system.md](../../reference/layout-system.md) |
| Existing selection or subgraph | [canvas-navigation.md](../../reference/canvas-navigation.md) |
| C# code and patch scopes | [csharp-boilerplate.md](../../reference/csharp-boilerplate.md) |
| Python code and tree/list access | [python-boilerplate.md](../../reference/python-boilerplate.md) |
| Script creation and port changes | [script-component-lifecycle.md](../../reference/script-component-lifecycle.md) |
| Type conversions and panel values | [data-type-guide.md](../../reference/data-type-guide.md) |
| Common component patterns | [gh-cookbook](../gh-cookbook/SKILL.md) |

For `.gh`/`.ghx` files use `gh_document`; for `.3dm` files use `rh_document`. Follow the shared [file-operation safeguards](../rhino-document/SKILL.md#units-and-files) for live handles, state tokens, unsaved changes, and uncertain outcomes.
