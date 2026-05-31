# Script Component Lifecycle (gh_edit_script)

Shared steps for Grasshopper **Python** and **C#** script components. Language templates → [csharp-boilerplate.md](./csharp-boilerplate.md), [python-boilerplate.md](./python-boilerplate.md).

## Create

1. `gh_edit_script` action `"create"`: `language` (`"python"` | `"csharp"`), `source`, `inputs`, `outputs`.
2. Each input: `name`, optional `typeHint` (`object` default, `double`, `string`, …).

## Update code

3. `gh_edit_script` `"setCode"`: pass full code. Include full `inputs`/`outputs` when the signature changes; omit lists if only code changes.

## Ports only

4. `gh_edit_param` `"syncParams"` — port changes without code changes.
5. Add/remove/edit params via `gh_edit_param` after creation.

## Rename ports (keep wires)

6. Same-order renames in a full `inputs`/`outputs` list apply in place.
7. Order change or name swap: `{ "name": "radius", "previousName": "r", "typeHint": "double" }`.
8. Omit `previousName` when only changing `typeHint` or access on an existing name.

## Critical

9. **Renaming a port requires updating the script in the same `setCode` call** — match `RunScript`/body variable names to new port names. Canvas-only renames break the solution.
