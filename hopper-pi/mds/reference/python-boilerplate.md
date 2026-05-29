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
1. Use `gh_edit_script` with action `"create"` to create a Python script node. Specify `language: "python"`, the code, and inputs/outputs. Each input may include `typeHint` (`object` default, `double` for numbers, `string` for text).
2. If you need to modify inputs/outputs after creation, use `gh_edit_param` to add/remove/edit parameters.
3. To update code and ports, use `gh_edit_script` `"setCode"` with full `inputs`/`outputs` when the signature changes (omit lists to leave ports unchanged).
4. For port-only sync, use `gh_edit_param` `"syncParams"`.
5. **Renaming ports (keep wires):** same-order renames in a full `inputs`/`outputs` list are applied in place. If order changes or swapping names, use `previousName`, e.g. `{ "name": "radius", "previousName": "r", "typeHint": "double" }`. Omit `previousName` when only updating `typeHint` or access.
6. **When renaming a port, always update the code too** — in the same `setCode` call, rename every input/output variable in the script body to match the new port names (e.g. change `r` to `radius` everywhere it is used). Renaming only the canvas ports without updating the script will break the solution.
