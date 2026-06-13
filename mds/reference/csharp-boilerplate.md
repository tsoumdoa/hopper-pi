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

## Agent workflow (preferred)

Do **not** emit the class wrapper or `using` lines. Use `gh_edit_script` with `scriptParts` — the server assembles the full Grasshopper script.

```json
{
  "action": "setCode",
  "targetId": "<guid>",
  "scriptParts": {
    "references": ["System", "Rhino.Geometry"],
    "runScript": "private void RunScript(\n  double x,\n  ref double a\n)\n{\n  a = x * 2;\n}"
  }
}
```

- `references`: namespace strings only (no `using`, no `;`). Omit to use the default GH set.
- `runScript`: the full `private void RunScript(...)` method.
- `helpers`: optional methods placed below `RunScript` inside the class.

### Small edits

Use `patchCode` instead of rewriting everything. Line numbers are **1-based within the chosen scope** (default `runScriptBody`):

```json
{
  "action": "patchCode",
  "targetId": "<guid>",
  "scope": "runScriptBody",
  "patches": [
    { "op": "replace", "startLine": 1, "endLine": 1, "lines": ["a = x * 3;"] }
  ]
}
```

Scopes: `runScriptBody` (default), `runScript`, `helpers`, `references`, `full`.

Read structured code with `getCodeParts` (returns `references`, `runScript`, `runScriptBody`, `helpers`, `lineMap`).

## Legacy full-code template

`code` with the full script still works, but prefer `scriptParts` / `patchCode`.

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
