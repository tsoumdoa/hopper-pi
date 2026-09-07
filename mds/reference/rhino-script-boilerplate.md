# Rhino document scripting

Follow [rhino-document](../skills/rhino-document/SKILL.md#persistent-scripts-first) for model edits. Save a named Python/C# script before mutation, including one-liners. Inline mutations and command macros require an explicit disposable-action request. GH script components use [script lifecycle](./script-component-lifecycle.md).

## Source templates

Python and C# run through Rhino 8 RhinoCode. Hopper adds the language shebang when missing. Python uses `scriptcontext.doc`; C# uses `RhinoDoc.ActiveDoc`. Print results so the agent can read them.

```python
import rhinoscriptsyntax as rs
import scriptcontext as sc

radius = 5.0  # Current model units
circle_id = rs.AddCircle((0, 0, 0), radius)
print(circle_id)
```

C# takes a script-editor body, without a class wrapper:

```csharp
using Rhino;
using Rhino.Geometry;

var doc = RhinoDoc.ActiveDoc;
var radius = 5.0; // Current model units
var id = doc.Objects.AddCircle(new Circle(Point3d.Origin, radius));
doc.Views.Redraw();
Console.WriteLine(id);
```

For object queries, prefer `rh_query_objects`. Rhino 8 does not support zero-argument `doc.Objects.GetObjectList()`. In source, use an explicit `ObjectType` filter or iterate the object table. For example:

```python
import Rhino
import scriptcontext as sc

print(sum(1 for obj in sc.doc.Objects.GetObjectList(
    Rhino.DocObjects.ObjectType.AnyObject)))
```

## Saved source and execution

Create an asset with `rh_script`:

```json
{"action":"create","name":"Circle study","language":"python","source":"import rhinoscriptsyntax as rs\nradius = 5.0\nprint(rs.AddCircle((0, 0, 0), radius))\n"}
```

Keep the returned `scriptId`, `workspaceId`, and revision. Before revising the same operation, inspect current document state and source. This patch assumes revision 1 still contains the shown radius and the new requested radius is 8 model units:

```json
{"action":"patch","scriptId":"<returned ID>","expectedRevision":1,"patches":[{"action":"replace","startLine":2,"endLine":2,"lines":["radius = 8.0"],"expectedText":"radius = 5.0"}]}
```

Patch lines are 1-based in the original revision; `insert.afterLine: 0` inserts before line 1. Use `setSource` with `expectedRevision` when replacing source is clearer.

Call `rh_script` with `action: "getExecutionTarget"` for document identity, units, and tolerances. Pass its `document` unchanged as `expectedDocument` to `rh_run_script`, with the chosen source revision:

```json
{"items":[{"scriptId":"<returned ID>","revision":2,"expectedDocument":{"documentId":"<returned document ID>","lifecycleInstanceId":"<returned lifecycle>","settingsRevision":"<returned settings revision>"}}]}
```

Editing never executes source. This creation example adds another circle on each run; it does not resize earlier output. Use verified existing GUIDs or tags for updates. Geometry Undo leaves source history intact.

## Reading and recovery

- `get` returns up to 200 numbered lines and 16,000 source characters. Follow `truncated`/`nextLine`; continue a `partialLine` with `characterOffset: partialLine.nextCharacterOffset` until null. Diffs cap at 12,000 characters.
- Source reads, history, and `getRun` work offline. `restore` copies historical source into a new head revision; `undelete` makes a deleted asset runnable again.
- For an uncertain execution, inspect `getRun` and call `reconcileRun`. Neither resubmits source. Asset/mixed batches stop after failure or uncertainty; inline-only batches continue after errors. Inspect partial geometry before any retry.

## Diagnostics and storage

Failure results include stages, elapsed times, exceptions, partial output, and captured Rhino loading messages. `unknown` means a stage was not observed. `code-run` can include initialization or compilation and does not prove user code started. Native stack frames are not user-source lines; an added shebang can shift runtime line numbers. For host initialization investigations, see [native verification notes](../../docs/document-script-integration-verification.md#language-warmup-regression-2026-09-07).

Source and journals live in `<scriptWorkspaceDir>/.hopper/rhino-scripts`, separately from CAD files. Embedded hosts default to `<dataDir>/workspaces/default`; CLI extensions use the selected project directory. Override with absolute `--script-workspace` or `HOPPER_SCRIPT_WORKSPACE`.

The default quota is 64 MiB. `WORKSPACE_LIMIT_REACHED` reports path and usage; configure `--script-workspace-quota-bytes` or `HOPPER_SCRIPT_WORKSPACE_QUOTA_BYTES` if needed. For `WORKSPACE_BUSY`, retry the same mutation identity after the writer finishes. Inspect unreadable/interrupted locks and confirm all writers have stopped before manual removal. History is not purged automatically; retained runs include bounded output, operation IDs, and source revision.
