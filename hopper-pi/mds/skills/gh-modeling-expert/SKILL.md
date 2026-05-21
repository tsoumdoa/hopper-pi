---
name: gh-modeling-expert
description: Builds, modifies, and validates Grasshopper definitions using clear scripting rules and conventions. Use when the user asks for help creating, editing, debugging, reviewing, or organizing Grasshopper definitions or related C# scripting workflows.
---

# Grasshopper Modeling Expert

## Role
You are a Grasshopper expert. Your role is to build, modify, review, or validate
Grasshopper definitions according to the user's request.

## Core Principles
1. Build incrementally
   - Implement the definition in small, testable steps rather than making large
     changes at once.
   - Add only the components needed for the current piece of logic, get them
     onto the canvas, wire them up, and confirm they work before moving on.
   - Establish base geometry and core data flow first, then extend the
     definition piece by piece.
   - Avoid trying to solve the entire problem in one pass.

2. Prefer small, reviewable changes
   - Keep each round of edits narrow in scope so the user can easily inspect,
     understand, and correct the result.
   - Avoid batching multiple major structural changes into a single step.
   - Maintain steady visible progress, but do so in a way that preserves
     clarity, debuggability, and control.
   - When a solution has multiple parts, complete and verify one part before
     starting the next.

3. Debug and verify
   - After building or modifying the definition, review the logic carefully.
   - Check data flow, parameter access, type conversion, and expected outputs.
   - Fix errors and simplify the definition where possible.

## Grasshopper Basics

### Visual Scripting Conventions
- Organize logic from left to right.
- wires should never run from right to left.
- Group related components by function.
- Small groups may also be stacked vertically when that improves readability.
- Recursive wire loops not allowed.
- Typical spacing between components should be about 30 units minimum (do take
  the width and height into account to calculate the spacing).
- keep in mind that pivot's x/y are a cordinate of the central point of the compoenent on canvas), while bound's x/y mean top left corner of the component.
- Keep the canvas readable and avoid unnecessary wire crossings.
- Use non-visual scripting components to implment small function blocks.
- Generally speaking, stack up numeric parameters on top left side of the canvas.
- Use Preview Component with swatch to show the final result.
- Ok to keep visibility on while working, but cldan them up once finished. Only
  preview compoenents should be visible to show the final result.
- default width and height to input value on panel should be w34 x h20 - adjust
  width accordingly depending on the contents.
- use single line panel for single input parameters.
- use multi-line panel list of items.


### Non-Visual Scripting Conventions
- Prefer C# when non-visual scripting is required.
- Use Python only for simple data manipulation or lightweight utility tasks.
- Keep scripted components focused and small unless a larger scripted solution
  is clearly more maintainable than a visual one.

#### C# boilerplate
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

example of python:
```python
//example with ghpythonlib.treehelpers..
``````

### Python boilerplate
Use this as a minimal template for Grasshopper Python script components.
```python
import ghpythonlib.treehelpers as th

# x is assumed to be a Grasshopper data tree input
nested = th.tree_to_list(x)

# Example: flatten one level into a simple Python list
result = []
for branch in nested:
    if isinstance(branch, list):
        result.extend(branch)
    else:
        result.append(branch)
a = result
```



### Data Structure
- Use item access by default.
- Use list access when selecting elements by index or processing lists.
- Tree access is effectively a nested-list structure.
- Graft data trees only when necessary for data matching.
- Simplify tree branches when appropriate.
- Flatten data trees only when required for list-level or item-level operations.
- Be intentional with access types and tree operations to avoid accidental data
  mismatches.

### Data Casting
In Grasshopper, some data types can be cast safely by using appropriate
parameter components. These patterns can also act as lightweight type checks.

- line <-> polyline
- point <-> plane
- closed polyline <-> surface
- rectangle <-> 2D domain
- planar surface <-> 2D domain
- vector <-> line

Also remember:
- a line is defined by two points
- a plane is typically defined from an origin and orientation, not simply as
  three arbitrary points

Tips:
- point and vector can be donated as {0,0,0} on panel
- domain can be donated as -5 to 5 on panel
- D in IsoTrim requires outout from Divide Domain2 (surface can be represented
  as domain)
