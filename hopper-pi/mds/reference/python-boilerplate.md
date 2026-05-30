# Grasshopper Python Script Component Rules

For create/rename/port workflow → [script-component-lifecycle.md](./script-component-lifecycle.md).

## Scope

Grasshopper Python component — not a standalone script. No `main()`, CLI, or package setup unless requested.

## Rules

- Use component I/O variables (`x`, `a`, …) directly; assign outputs to output vars.
- Minimal code; suitable for repeated recomputation.
- `ghpythonlib.treehelpers` for list/tree work; prefer simple Python lists for list outputs.
- Port changes: `gh_edit_param`.

## Template

```python
import ghpythonlib.treehelpers as th

nested = th.tree_to_list(x)

result = []
for branch in nested:
    if isinstance(branch, list):
        result.extend(branch)
    else:
        result.append(branch)

a = result
```
