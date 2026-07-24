# Rhino Document Scripting (rh_run_script)

Use this for **Rhino document** work via `rh_run_script`. For a new Grasshopper script component use `gh_apply_graph.scripts`; for an existing component use `gh_edit_script` and [python-boilerplate.md](./python-boilerplate.md) / [csharp-boilerplate.md](./csharp-boilerplate.md).

## Modes

| mode | When to use |
|------|-------------|
| `command` | Short Rhino macros: `_Circle 0,0,0 5`, `_SelLayer`, `-Layer Current "Default"` |
| `python` | Multi-step geometry, loops, `rhinoscriptsyntax` (Rhino 8 RhinoCode / Python 3) |
| `csharp` | Rhino C# script editor body (Rhino 8 RhinoCode) |

Python and C# both run through **RhinoCode** (`Rhino.Runtime.Code`) in Rhino 8. Hopper prepends the language shebang if you omit it (`#! python 3` / `// #! csharp`).

## Python pattern

```python
import rhinoscriptsyntax as rs
import scriptcontext as sc

doc = sc.doc
ids = rs.AddCircle((0, 0, 0), 5.0)
print(ids)
```

- Use `scriptcontext.doc` for the active document.
- Use `print()` for values the agent should read in the tool result.

### Listing / counting objects

Rhino 8 **does not** support `doc.Objects.GetObjectList()` with zero arguments. Prefer:

- **`rh_query_objects`** from the agent (short IDs, filters, `countOnly`) — best for Hopper workflows.
- **RhinoCommon:** `doc.Objects.GetObjectList(Rhino.DocObjects.ObjectType.AnyObject)` or iterate `for obj in doc.Objects:`.
- **rhinoscriptsyntax:** `rs.ObjectsByType(rs.filter.allobjects)` — not raw `GetObjectList()`.

```python
import rhinoscriptsyntax as rs
import scriptcontext as sc
import Rhino

doc = sc.doc
count = len(rs.ObjectsByType(rs.filter.allobjects))
print(f"Total objects in doc: {count}")
```

## C# pattern

```csharp
using Rhino;
using Rhino.Geometry;

var doc = RhinoDoc.ActiveDoc;
var id = doc.Objects.AddCircle(new Circle(Point3d.Origin, 5.0));
doc.Views.Redraw();
Console.WriteLine(id);
```

- Write the **script editor body** only (no class wrapper). Hopper adds `// #! csharp` when missing.
- Use `Console.WriteLine(...)` the same way Python uses `print(...)` — both are captured in the tool result.
- Prefer `RhinoDoc.ActiveDoc` (or geometry APIs that accept `doc`) for document work.

## Command pattern

- Prefix suppressed commands with `_` (e.g. `_Circle`).
- Chain with spaces or newlines as in the Rhino command line.

## Undo

When Hopper Pi lifecycle hooks run, all `rh_run_script` calls in one agent turn are grouped into **one Rhino Undo** step (separate from Grasshopper canvas undo).

## Do not use rh_run_script for

- Adding GH components, wires, sliders → `gh_*` tools
- Creating a GH Python/C# **script node** in a new graph → `gh_apply_graph.scripts`
- Editing an existing GH Python/C# **script node** → `gh_edit_script`
