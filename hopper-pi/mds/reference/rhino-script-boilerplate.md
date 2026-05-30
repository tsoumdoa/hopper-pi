# Rhino Document Scripting (rh_run_script)

Use this for **Rhino document** work via `rh_run_script`. For Grasshopper script **components**, use `gh_edit_script` and [python-boilerplate.md](./python-boilerplate.md).

## Modes

| mode | When to use |
|------|-------------|
| `command` | Short Rhino macros: `_Circle 0,0,0 5`, `_SelLayer`, `-Layer Current "Default"` |
| `python` | Multi-step geometry, loops, `rhinoscriptsyntax` |
| `csharp` | Rhino C# script editor body (Rhino 8 RhinoCode in-process) |

## Python pattern

```python
import rhinoscriptsyntax as rs
import scriptcontext as sc

doc = sc.doc
ids = rs.AddCircle((0, 0, 0), 5.0)
print(ids)
```

- Use `scriptcontext.doc` (not a standalone `if __name__` block).
- Use `print()` for values the agent should read in the tool result.

## Command pattern

- Prefix suppressed commands with `_` (e.g. `_Circle`).
- Chain with spaces or newlines as in the Rhino command line.

## Undo

When Hopper Pi lifecycle hooks run, all `rh_run_script` calls in one agent turn are grouped into **one Rhino Undo** step (separate from Grasshopper canvas undo).

## Do not use rh_run_script for

- Adding GH components, wires, sliders → `gh_*` tools
- Editing a GH Python/C# **script node** → `gh_edit_script`
