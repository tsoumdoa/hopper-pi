# Grasshopper C# Script Component Rules

Use this file for Grasshopper C# script components.

## Scope

Assume code targets a Grasshopper C# script component inside Rhino, not a standalone C# app.

## Rules

- Put main logic in `RunScript(...)`.
- Inputs are normal parameters.
- Outputs are `ref` or `out` parameters.
- Use RhinoCommon types directly when known.
- All types of param become objects in Grasshopper c# components, you have to
  explicitly cast them to the expected type.
- Add helper methods below `RunScript(...)` only when helpful.
- Prefer `List<T>` for list inputs and outputs.
- Use `DataTree<T>` only when the task requires tree data.
- Keep code minimal, compilable, and suitable for repeated Grasshopper recomputation.

## Mandatory Code Structure 
**You need to pass the whole code to gh_edit_script function**

```csharp
// you may add or remove declarations here
// most commonly used ones shown below
using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Rhino;
using Rhino.Geometry;
using Grasshopper;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Types;


public class Script_Instance : GH_ScriptInstance
{
  private void RunScript(
    object center,
    object radius,
    ref object circle
  )
  {
    Point3d c = (Point3d)center;
    double r = Convert.ToDouble(radius);

    circle = new Circle(c, r);
  }
}
```
