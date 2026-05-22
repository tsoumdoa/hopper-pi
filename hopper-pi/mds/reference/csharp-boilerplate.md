# C# Boilerplate for Grasshopper Script Components

Use this as a minimal template for Grasshopper C# script components.

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
    // Inputs
    Point3d point,
    double radius,

    // Outputs
    ref Circle circle
  )
  {
    circle = new Circle(point, radius);
  }
}
```
