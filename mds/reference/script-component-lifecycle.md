# Script Component Lifecycle (gh_edit_script)

Shared steps for Grasshopper **Python** and **C#** script components. Language templates → [csharp-boilerplate.md](./csharp-boilerplate.md), [python-boilerplate.md](./python-boilerplate.md).

## Create

1. `gh_edit_script` action `"create"`: `language` (`"python"` | `"csharp"`), `source`, `inputs`, `outputs`.
2. Each input: `name`, optional `typeHint` (`object` default, `double`, `string`, …).

## Update code

3. `gh_edit_script` `"setCode"`: C# — pass `scriptParts` (preferred) or full `code`. Python — pass full `code`. Include full `inputs`/`outputs` when the signature changes; omit lists if only code changes.
4. Small edits: `"patchCode"` with line patches — C# default scope `runScriptBody`, Python default scope `body`. Use scope `full` to patch anywhere.
5. Read split code: `"getCodeParts"` — C# returns `references`, `runScript`, `runScriptBody`, `helpers`, `lineMap`; Python returns `imports`, `body`, `lineMap`.

## Ports only

6. `gh_edit_param` `"syncParams"` — port changes without code changes.
7. Add/remove/edit params via `gh_edit_param` after creation.

## Rename ports (keep wires)

8. Same-order renames in a full `inputs`/`outputs` list apply in place.
9. Order change or name swap: `{ "name": "radius", "previousName": "r", "typeHint": "double" }`.
10. Omit `previousName` when only changing `typeHint` or access on an existing name.

## Critical

11. **Renaming a port requires updating the script in the same `setCode` call** — match `RunScript`/body variable names to new port names. Canvas-only renames break the solution.
