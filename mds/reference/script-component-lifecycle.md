# Script Component Lifecycle (gh_edit_script)

Shared steps for Grasshopper **Python** and **C#** script components. Language templates → [csharp-boilerplate.md](./csharp-boilerplate.md), [python-boilerplate.md](./python-boilerplate.md).

## Create

1. `gh_edit_script` action `"create"`: set `language`, then pass Python `code` or C# `scriptParts`, plus desired `inputs` and `outputs`.
2. Each input: `name`, optional `typeHint` (`object` default, `double`, `string`, …).

## Update code

3. `gh_edit_script` `"setCode"`: C# — pass `scriptParts` (preferred) or full `code`. Python — pass full `code`. Include full `inputs`/`outputs` when the signature changes; omit lists if only code changes.
4. Small edits: `"patchCode"` with line patches — C# default scope `runScriptBody`, Python default scope `full` (line numbers from file top).
5. Read split code: `"getCodeParts"` — C# only (returns `references`, `runScript`, `runScriptBody`, `helpers`, `lineMap`). Python: use `"getCode"`.

## Ports only

6. Use `gh_edit_param` for add/remove, access, type hint, mapping, simplify, or reverse changes that do not rename variables used by code.
7. Use `syncParams` when the full desired port list is clearer than several one-off edits.

## Rename ports atomically

8. Rename with `gh_edit_script` `setCode`, updating both code and the complete `inputs`/`outputs` list in the same call. A canvas-only rename can break the solution.
9. Same-order renames update ports in place and preserve wires.
10. For an order change or name swap, map identity explicitly: `{ "name": "radius", "previousName": "r", "typeHint": "double" }`.
11. Omit `previousName` when only changing properties on an existing name.
