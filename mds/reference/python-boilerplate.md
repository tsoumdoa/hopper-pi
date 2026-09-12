# Grasshopper Python scripts

Use component I/O variables directly and assign outputs. Keep code safe for repeated recomputation. For Rhino document scripts, see [Rhino scripting](./rhino-script-boilerplate.md).

## Source edits

New nodes use full `code` in `gh_apply_graph.scripts`; existing nodes use `gh_edit_script`. See [script lifecycle](./script-component-lifecycle.md) for port creation and renames.

```json
{
  "action": "setCode",
  "targetId": "<returned ID>",
  "code": "a = x * 2"
}
```

Read current source with `getCode` before `patchCode`. Python patch lines are 1-based from the script top; the default scope is `full`. `getCodeParts` is C#-only.

```json
{
  "action": "patchCode",
  "targetId": "<returned ID>",
  "patches": [
    { "op": "replace", "startLine": 1, "endLine": 1, "lines": ["a = x * 3"] }
  ]
}
```

## List vs tree access types

Access controls data shape and how often a component runs. Set it in script port definitions, or use `gh_edit_param` with `editAccessType` for existing ports. Default access is `item`.

| Access | Input | Output |
|--------|-------|--------|
| `item` | One value per invocation | One value |
| `list` | One branch per invocation | A list |
| `tree` | A Grasshopper DataTree | A DataTree |

A plain list on a tree output can cause Goo conversion errors. Inspect the failing port, access, type hints, and runtime messages before choosing a fix.

### Flatten intentionally

For tree input `x` and tree output `a`, collect every branch into one list and create a new single-branch tree:

```python
import ghpythonlib.treehelpers as th

a = th.list_to_tree(list(x.AllData()))
```

### Preserve paths

For a numeric tree, work directly with branches when paths and empty branches must survive:

```python
from Grasshopper import DataTree

a = DataTree[object]()
for i in range(x.BranchCount):
    path = x.Path(i)
    a.EnsurePath(path)
    a.AddRange([value * 2 for value in x.Branch(i)], path)
```

For passthrough, assign `a = x`. `tree_to_list` and `list_to_tree` are useful for regular nested lists, but a nested list cannot represent every GH path structure. See McNeel's [data-tree guide](https://developer.rhino3d.com/en/guides/rhinopython/grasshopper-datatrees-and-python/) and [DataTree methods](https://developer.rhino3d.com/api/grasshopper/html/Methods_T_Grasshopper_DataTree_1.htm).
