# Grasshopper Python Script Component Rules

Use this for Grasshopper Python script components.

- Assume code runs inside a Grasshopper Python component, not a standalone Python script.
- Use existing component inputs and outputs directly, such as `x`, `y`, or named inputs.
- You can edit input/ output by calling gh_edit_param tool.
- Assign outputs directly to output variables such as `a`.
- Keep code minimal and suitable for repeated Grasshopper recomputation.
- Use `ghpythonlib.treehelpers`  when working with list or tree.
- Prefer simple Python lists for list outputs.
- Do not add `main()`, CLI code, package setup, or standalone script structure unless requested.

## Preferred pattern

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

## Creating python script component
**you must follow the following steps**
1. Create a new python script component in Grasshopper using the tool gh_edit_components.
2. Set input and output parameters with correct variable names, data types, and access types using the tool gh_edit_param.
3. Set the code to the comoponent using the tool gh_edit_script.
