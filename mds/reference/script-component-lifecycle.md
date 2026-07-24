# Script Component Lifecycle

Shared steps for Grasshopper **Python** and **C#** script components. Language templates → [csharp-boilerplate.md](./csharp-boilerplate.md), [python-boilerplate.md](./python-boilerplate.md).

## Create inside a new graph

1. Add the node to `gh_apply_graph.scripts` with its local `ref`, language, position, source, inputs, and outputs.
2. Pass Python full `code`; prefer C# `scriptParts`.
3. Wire the node using its local ref in the same graph request.

Each port has `name` and optional `typeHint` (`object` default, `double`, `int`, `string`, or `bool`).

## Edit an existing script

1. `gh_edit_script` `"setCode"`: C# — pass `scriptParts` (preferred) or full `code`. Python — pass full `code`. Include full `inputs`/`outputs` when the signature changes; omit lists if only code changes.
2. Small edits: `"patchCode"` with line patches — C# default scope `runScriptBody`, Python default scope `full` (line numbers from file top).
3. Read split code: `"getCodeParts"` — C# only. Python: use `"getCode"`.

## Ports only

Use `gh_edit_param` for add/remove, access, type hint, mapping, simplify, or reverse changes on an existing script when code variables do not need renaming. Use `syncParams` when the full desired port list is clearer than several one-off edits.

## Rename ports atomically

Rename with `gh_edit_script` `setCode`, updating both code and the complete `inputs`/`outputs` list in the same call. A canvas-only rename can break the solution. Same-order renames update ports in place and preserve wires. For an order change or name swap, map identity explicitly: `{ "name": "radius", "previousName": "r", "typeHint": "double" }`. Omit `previousName` when only changing properties on an existing name.
