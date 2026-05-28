# Grasshopper C# Script Component Rules

Use this file for Grasshopper C# script components.

## Scope

Assume code targets a Grasshopper C# script component inside Rhino, not a standalone C# app.

## Rules

- Inputs can be typed directly (e.g. `double x`, `List<Point3d> curves`) or `object` with a cast inside RunScript.
- Outputs are `ref` parameters (e.g. `ref double a`, `ref object a`) — assign your result directly to the output variable.
- The agent's primary job is naming input/output params correctly. The rest is boilerplate.
- Add helper methods below `RunScript(...)` only when needed.
- Prefer `List<T>` for list inputs and outputs.
- Use `DataTree<T>` only when the task requires tree data.
- Keep code minimal, compilable, and suitable for repeated Grasshopper recomputation.

## Mandatory Code Structure 
**You need to pass the whole code to gh_edit_script function**

```csharp
// add or remove declarations as needed
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
    double x,       // one param per input (typed or object)
    ref double a    // one ref param per output (typed or ref object)
  )
  {
    // If an input is object, cast it to the expected type
    // Do work
    // Assign to output params
  }
}
```

## Creating C# script component
**you must follow the following steps**
1. Use `gh_edit_script` with action `"create"` to create a C# script node. Specify `language: "csharp"`, the code, and inputs/outputs. Each input should include a name.
2. If you need to modify inputs/outputs after creation, use `gh_edit_param` to add/remove/edit parameters.
3. To update the code, use `gh_edit_script` with action `"setCode"`.
