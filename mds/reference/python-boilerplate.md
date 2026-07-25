# Grasshopper Python Script Component Rules

For create/rename/port workflow → [script-component-lifecycle.md](./script-component-lifecycle.md).

## Scope

Grasshopper Python component — not a standalone script. No `main()`, CLI, or package setup unless requested.

## Rules

- Use component I/O variables (`x`, `a`, …) directly; assign outputs to output vars.
- Minimal code; suitable for repeated recomputation.
- `ghpythonlib.treehelpers` for tree ↔ list conversion; prefer plain Python lists only for **list-access** outputs (not tree-access).
- New graph node: `gh_apply_graph.scripts` with full `code`. Existing code: `gh_edit_script`. Existing port-only changes: `gh_edit_param`. Port renames: update code and full port lists together with `gh_edit_script setCode`.

## Agent workflow (preferred)

Unlike C#, there is no class wrapper — emit the full script via `code` in `gh_apply_graph` or `gh_edit_script setCode`.

```json
{
  "action": "setCode",
  "targetId": "<guid>",
  "code": "import ghpythonlib.treehelpers as th\n\na = x * 2"
}
```

### Small edits

Use `patchCode` instead of rewriting everything. Line numbers are **1-based from the top of the script** (default scope `full`):

```json
{
  "action": "patchCode",
  "targetId": "<guid>",
  "patches": [
    { "op": "replace", "startLine": 3, "endLine": 3, "lines": ["a = x * 3"] }
  ]
}
```

Read code with `getCode` (returns full source). `getCodeParts` is C#-only.

## List vs tree (access types)

Python lists are what you code against; Grasshopper DataTrees are what tree-access ports expect. Item/list/tree access also changes **how often** the component runs.

| Port access | Input: what `x` is | Output: what to assign |
|-------------|-------------------|------------------------|
| `item` | one value | `a = value` |
| `list` | a Python list (one branch per run) | `a = py_list` |
| `tree` | Grasshopper DataTree | read via `tree_to_list`; write via `list_to_tree` |

Set access on ports via `gh_edit_param` `editAccessType`. Default is `item`.

If a downstream component shows `Data conversion failed from Goo to …`, the Python script likely returned a plain list on a tree-access output — run `gh_get_canvas_errors` for an inline fix hint.

### Recipe 1 — Flatten tree input → flat list work → tree output

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

### Recipe 2 — Keep branch structure (per-branch work → tree output)

```python
import ghpythonlib.treehelpers as th

nested = th.tree_to_list(x)
out = []
for branch in nested:
    out.append([item * 2 for item in branch])  # example per-branch work
a = th.list_to_tree(out)
```

### Recipe 3 — Tree passthrough (no conversion)

```python
a = x  # x is already a DataTree; output port must be tree access
```

### Anti-patterns

- `a = result` when output port is **tree** access (missing `list_to_tree`)
- `for item in x:` when input port is **tree** access (use `tree_to_list` first)
- `tree_to_list` / `list_to_tree` without `import ghpythonlib.treehelpers as th`
