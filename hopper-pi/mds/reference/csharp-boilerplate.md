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
  private void RunScript( // <- where main logic goes
    // Inputs to be defined like this
    object point, // object can be used as generic type for object
    double radius, // double has to be used for number  

    // Outputs to be defined like this
    ref Circle circle
  )
  {
      // your code goes here
    circle = new Circle(point, radius);
  }
  // you can have additional methods here
}
```

**TIPS**
- You can remove default x and y input params
- You can remove default output param - a and out params
