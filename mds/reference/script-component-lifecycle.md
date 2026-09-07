# GH script lifecycle

Applies to GH C#/Python components. Use [Rhino scripting](./rhino-script-boilerplate.md) for direct Rhino document work.

## Create

Add the node to `gh_apply_graph.scripts` with a local ref, language, position, source, and port lists. Use full `code` for Python and preferably `scriptParts` for C#. Wire local refs in the same request.

Ports have `name` and optional `typeHint`, `access`, `dataMapping`, `simplify`, and `reverse`. Type hints include `object`, the default, plus `double`, `int`, `string`, and `bool`. Access defaults to `item`; choose `list` or `tree` when needed.

## Edit

Read current source first. Use `gh_edit_script` with `setCode` for replacement, or `patchCode` for small edits. Include complete `inputs`/`outputs` when the signature changes; omit them for code-only edits. See [C#](./csharp-boilerplate.md) or [Python](./python-boilerplate.md) for source formats and patch scopes.

Use `gh_edit_param` for port properties, add/remove, or `syncParams` when code variables do not need renaming.

## Rename ports

Use `gh_edit_script` with `setCode`, updating source and complete port lists together. A canvas-only rename can break code. Same-order renames preserve wires. For reordering or name swaps, map identity explicitly:

```json
{"name":"radius","previousName":"r","typeHint":"double"}
```

Omit `previousName` when keeping an existing name.
