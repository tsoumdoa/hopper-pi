# Grasshopper C# scripts

Use for GH script components. For Rhino document scripts, see [Rhino scripting](./rhino-script-boilerplate.md). Shared creation and port rules are in [script lifecycle](./script-component-lifecycle.md).

## Source and ports

For a new node, use `gh_apply_graph.scripts[].scriptParts`; for existing code, use `gh_edit_script` with `setCode`. Hopper assembles the class wrapper.

```json
{
  "action": "setCode",
  "targetId": "<returned ID>",
  "scriptParts": {
    "references": ["System", "Rhino.Geometry"],
    "runScript": "private void RunScript(double x, ref object a)\n{\n  a = x * 2;\n}"
  }
}
```

`references` contains namespace names without `using` or semicolons; omit it for the default GH set. `runScript` is the complete method. Optional `helpers` are methods below it. Full source via `code` remains supported.

Match inputs to port types and access. Assign `ref` outputs directly. Prefer `List<T>` for lists and `DataTree<T>` when branch paths matter. Keep code safe for repeated recomputation.

## Small edits

Read `getCodeParts` before patching; it returns `references`, `runScript`, `runScriptBody`, `helpers`, and `lineMap`. Patch line numbers are 1-based within the selected scope.

```json
{
  "action": "patchCode",
  "targetId": "<returned ID>",
  "scope": "runScriptBody",
  "patches": [
    { "op": "replace", "startLine": 1, "endLine": 1, "lines": ["a = x * 3;"] }
  ]
}
```

Scopes are `runScriptBody`, the default, plus `runScript`, `helpers`, `references`, and `full`. Use current source lines. For signature or port-name changes, update code and complete port lists together through `setCode`.
