# Grasshopper C# Script Component Rules

For create/rename/port workflow → [script-component-lifecycle.md](./script-component-lifecycle.md).

## Scope

Grasshopper C# script component inside Rhino — not a standalone app.

## Rules

- Inputs: typed (`double x`, `List<Point3d> pts`) or `object` with cast in `RunScript`.
- Outputs: `ref` parameters — assign directly.
- Name I/O params correctly; keep code minimal and recomputation-safe.
- Helpers below `RunScript` only when needed.
- Prefer `List<T>`; `DataTree<T>` only when trees are required.

## Template

Pass **whole code** to `gh_edit_script`.

```csharp
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
    double x,
    ref double a
  )
  {
      // Do works
      // Assign to output params
  }
}
```
