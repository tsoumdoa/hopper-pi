# Grasshopper Python Script Component Rules

For create/rename/port workflow → [script-component-lifecycle.md](./script-component-lifecycle.md).

## Scope

Grasshopper Python component — not a standalone script. No `main()`, CLI, or package setup unless requested.

## Rules

- Use component I/O variables (`x`, `a`, …) directly; assign outputs to output vars.
- Minimal code; suitable for repeated recomputation.
- `ghpythonlib.treehelpers` for list/tree work; prefer simple Python lists for list outputs.
- Port changes: `gh_edit_param`.

## Agent workflow (preferred)

Unlike C#, there is no class wrapper — emit the full script via `code` on `create` / `setCode`.

```json
{
  "action": "setCode",
  "targetId": "<guid>",
  "code": "import ghpythonlib.treehelpers as th\n\na = x * 2"
}
```

### Small edits

Use `patchCode` instead of rewriting everything. Line numbers are **1-based within the chosen scope** (default `body` — logic after imports):

```json
{
  "action": "patchCode",
  "targetId": "<guid>",
  "scope": "body",
  "patches": [
    { "op": "replace", "startLine": 1, "endLine": 1, "lines": ["a = x * 3"] }
  ]
}
```

Scopes: `body` (default), `imports`, `full`.

Read structured code with `getCodeParts` (returns `imports`, `body`, `lineMap`).

## Examples to work with list and tree
list is what python expeccts, and tree is what Grasshopper expects

```python
import ghpythonlib.treehelpers as th

nested = th.tree_to_list(x)

result = []
for branch in nested:
    if isinstance(branch, list):
        result.extend(branch)
    else:
        result.append(branch)

a = th.list_to_tree(result)
```
