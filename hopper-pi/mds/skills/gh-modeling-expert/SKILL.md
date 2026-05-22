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

## GRASSHOPPER CONVENTIONS — NON-NEGOTIABLE 

### Visual Scripting Conventions
- Organize logic from left to right and go down as needed, no wire running from right to left.
- Recursive logic not allowed.
- Group related components by function, it should have clear inputs and outputs.
- Do not group a compoenent that is a port of the other groups, nested groups
  allowed only if all compoentns are in the same group.
- Let the canvas breathe vertically but keep it tight horizontally
- aim ~100–120px between component centers horizontally and ~50–70px vertically
- Place large components (Graph Mapper, Panel, etc.) near their primary consumer, not their producer                │
- do consider width and height whey arranging components on the canvas.
- no overlapping components.
- bound's x/y mean top left corner of the component, with w/h giving its full size.
- **Always use bounds-based arithmetic for component layout** — never use pivot for spacing. To place the next component without overlap, compute: `next_bounds.x = prev_bounds.x + prev_bounds.w + gap`. Each placement must be informed by the previous component's actual rendered bounds.
- Keep the canvas readable and avoid unnecessary wire crossings.
- Use non-visual scripting components to implment small function blocks.
- Generally speaking, stack up numeric parameters on top left side of the canvas.
- Use Preview Component with swatch to show the final result.
- Ok to keep visibility on while working, but cldan them up once finished. Only
  preview compoenents should be visible to show the final result.
- colour swatch for preview component should be placed on the **left** side of the preview component directly, to be vertically aligned to the input param M.
- default width and height to input value on panel should be w34 x h28 - adjust
  width accordingly depending on the contents.
- use single line panel for single input parameters.
- use multi-line panel list of items.


### Non-Visual Scripting Conventions
- Prefer C# when non-visual scripting is required.
- Use Python only for simple data manipulation or lightweight utility tasks.
- Keep scripted components focused and small unless a larger scripted solution
  is clearly more maintainable than a visual one.

#### C# boilerplate
See [reference/csharp-boilerplate.md](../../../mds/reference/csharp-boilerplate.md) for the full C# script component template.

### Python boilerplate
See [reference/python-boilerplate.md](../../../mds/reference/python-boilerplate.md) for the full Python script component template.

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
- Graph mapper work only with normalized value (0-1), also need to ask your to
  set the mapper manually.

### Final Step
- Ensure there is no error.
- Ensure all components have a clear purpose and are placed in a logical order.
  while input params like sliders, panels, toggles should be organized on the left hand side of the canvas.
- Ensure the canvas is clean and readable, no overlapping components or groups.
- Clean up unused components that are no longer needed.
- Hide intermediate components that are no longer needed.
