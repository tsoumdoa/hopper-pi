# GH Conventions (Shared Reference)

> **All agents must follow these rules.** This file is injected into every subagent prompt. Do NOT duplicate these rules in individual agent files — reference this document instead.

## Geometry Approach
- Start by defining geometry with simple primitives: points `Pt {x, y, z}`, lines, and surfaces
- Domain is a range — syntax: `"-2.5 to 2.5"` or `"0 to 100"`
- Build from simple geometry first; once a line or surface exists, it can be extruded
- Use a guide vector for extrusion; use Amplitude to control extrusion distance

## Script Policy
- **Avoid script components** as much as possible. Use them only for special cases where no standard component can do the job. Never use scripts to implement complex multi-step workflows that could be done with standard components chained together.
- When you MUST script: **prefer C# over Python**

## C# Script Boilerplate (Mandatory)
Every C# script component requires this exact structure:

1. **All standard `using` directives** (`System`, `System.Linq`, `Rhino.Geometry`, `Grasshopper.Kernel`, etc.)
2. `public class Script_Instance : GH_ScriptInstance`
3. `private void RunScript(...)`
4. Never omit the usings or class wrapper — Grasshopper won't compile without them.

### The Exact Structure (copy this, fill in the blanks)
```csharp
using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Rhino;
using Rhino.Geometry;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Types;

public class Script_Instance : GH_ScriptInstance
{
  private void RunScript(
    // INPUTS — plain params, one per line, NO ref:
    <type> <name>,
    // OUTPUTS — ALL must use ref, one per line:
    ref <type> <name>
  )
  {
    // ← ALL implementation code goes here, INSIDE this method only →
  }
}
// ← NOTHING after this closing brace
```

### I/O Declaration Workflow (canvas-agent / python-agent only)
> **cs-agent skip this section** — your I/O is already declared.
>
> For agents that create script nodes from scratch:
> 1. Create the script node (`gh_edit_script` with empty code)
> 2. **Declare I/O parameters BEFORE writing code** using `gh_edit_param`:
>    - `addInput` for each input (name + paramType + access)
>    - `addOutput` for each output (name + paramType)
> 3. **Call `gh_get_canvas()` and inspect the live component's actual ports**
> 4. If unexpected default ports exist (`x`, `y`, `a`, etc.), remove them with `gh_edit_param`
> 5. Only THEN write `RunScript` code matching live port names exactly
> 6. After writing code, call `gh_get_canvas_errors()` to check

### Reality Check
Some GH C# script nodes keep generic `object` inputs/outputs even after parameter declaration, or retain default ports. **Do NOT assume `gh_edit_param` guarantees a strongly typed compiled signature.** The live node (from `gh_get_canvas`) is the source of truth.

### RunScript Signature Rules
- **Inputs** = plain parameters matching live ports by name and order (**no `ref`, no `out**)
- **Outputs** = `ref` parameters matching live ports by name and order (**never forget `ref`** — without it outputs become inputs; never use `out` — GH doesn't support it)
- Prefer specific types: `double`, `string`, `int`, `bool` for primitives
- Prefer specific geometry types where stable: `Curve`, `Brep`, `Mesh`, `Point3d`, `Line`, `Surface`
- Collections: `List<T>` for lists, `DataTree<T>` for data trees
- Use `object` only when forced by live port reality; convert explicitly inside body (`Convert.ToDouble()`, etc.)
- **Anti-hallucination rule:** after any `gh_edit_param` change on a C# script, fetch canvas again before finalizing code

### Code Placement Rules (critical)
- **ALL logic must be inside `RunScript`'s `{ }` body** — no helper methods, no fields at class level
- **Nothing after the class closing `}`** — no extra methods, no using statements dangling below
- If you need reusable logic, use local variables or a local function inside RunScript

## Canvas Layout Rules
- **No self-loops** in the definition (cyclic dependencies are bugs)
- Organize **left-to-right** in clear logical flow (data enters left, exits right)
- Place components in **positive coordinate space** (all X, Y > 20) to keep canvas tidy
- Use **Groups** to separate logical parts of the definition for clarity
- Name groups with numeric prefix: `01_Inputs`, `02_[Name]`, etc.

## Component Placement Reasoning
- **Ports stack vertically** on a component's edges (inputs left, outputs right). A component with more ports is taller.
- **Port-adjacent placement:** when feeding a specific port, align the feeder's vertical center with that port's position. Feeder right edge + ~15px gap = target left edge.
- **Parallel branches → separate Y-rows** so wires don't overlap.
- **Groups auto-fit contents** — place components first, wrap groups after.

## Visibility & Preview Rules

### Who Does What
| Task | Owner | When |
|------|-------|-----|
| Flag visual geometry outputs | interpreter | Phase 1 — classify outputs as "visual" or "data" |
| Plan Preview Pattern (components + wiring + hide list) | gh-expert | Phase 2 — include in blueprint |
| Create Preview/Swatch, wire them, set hidden:true | canvas-agent | Phase 3 — execute as part of build |
| Verify Preview Pattern is present and correct | validator | Phase 5 — compliance check |

### The Preview Pattern
When the definition produces **visual geometry output**, it **must** terminate with a **Custom Preview** + **Colour Swatch** pair as the rightmost components.

**Wiring (exact):**
- Final geometry output → **Preview.G** (`Geometry to preview` port)
- Swatch output (**Swatch.V**) → **Preview.M** (`The material override` port)

### Hiding Rules
Set `hidden: true` on ALL intermediate geometry-producing components:
- Scripts, extrude, loft, mesh, brep operations, vector math, transform, etc.
- Anything that produces geometry between inputs and the final output

**Keep visible (only these):**
- **Input components** — sliders, panels, toggles, swatches, value lists, geometry params (users tweak these)
- **Custom Preview** + its colour/material feeders (this IS the viewport output)
- **Scribbles / annotations** (informational)

### What Counts as "Visual Geometry Output"
Any output type that renders in the Rhino viewport: `Curve`, `Brep`, `Mesh`, `Surface`, `Point3d` (as geometry), `Line`. Pure data outputs (`double`, `int`, `string`, `List<number>`) do NOT need a preview.

## Quality Bar
- Keep solutions **simple** — a boring, reliable solution beats an overly clever one
- Pay close attention to **data access modes** (item/list/tree) — ensure each component is configured correctly
- When in doubt, prefer more explicit components over fewer magical ones
