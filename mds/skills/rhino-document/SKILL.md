---
name: rhino-document
description: Inspect and edit Rhino documents, geometry, layers, blocks, materials, and views with persistent scripts. Use for active RhinoDoc work and direct baking; use gh-modeling-expert for Grasshopper canvas editing.
---

# Rhino document

## Choose the tool

Use task-specific tools and APIs. Verify unfamiliar methods and overloads against tool schemas, API documentation, or read-only inspection before using them.

| Task | Tool |
|------|------|
| Rhino files, document identity, units, tolerances | `rh_document` |
| Saved Python/C# source and run history | `rh_script` |
| Geometry, layers, selection, blocks, materials, direct/current bake | `rh_script` then `rh_run_script` |
| Viewport, camera, projection, CPlane, zoom | `rh_view_control` |
| Object filters, counts, IDs | `rh_query_objects` |
| Visual inspection | `rh_capture_view` when available |
| Rhino geometry references in GH | `gh_param_rhino` |
| GH files or canvas edits | `gh_document` or `gh_*` |

Use both tool families for mixed requests. `gh_edit_script` edits a GH component; it does not run Rhino document scripts. For a reusable GH bake pipeline, use [Recipe 9](../gh-cookbook/reference/recipe-9-bake-geometry.md). Clarify ambiguous baking only when the distinction affects the requested result.

## Persistent scripts first

Before any model mutation, create or update a named `rh_script`, unless the user explicitly requests an inline disposable action. This includes one-line edits. File and view operations use their dedicated tools above. Read-only inspection needs no saved script.

1. Inspect the current document and relevant objects first. Call `rh_script` with `action: "getExecutionTarget"` for document identity and settings. Never assume earlier names, selection, IDs, or geometry still apply.
2. Create a new named script for each distinct user request. Reuse an asset only for a clear revision of the same operation, after reading its current source and revision. Discover `rh_script` through `hopper_search_tools` if needed.
3. Record current parameters, units, and targets explicitly in source. Changed parameters or targets require a new revision or new script based on fresh inspection. Use `patch` or `setSource` with the returned `expectedRevision`; never blindly replace stale hardcoded values.
4. Preserve reproducibility with full object GUIDs or stable tags and recorded generated results. Capture random seeds or generated inputs when needed. Make follow-up edits target verified prior output; rerunning creation code can produce duplicates.
5. Execute through `rh_run_script.items` with the returned `scriptId`, chosen `revision`, and the execution target's `document` unchanged as `expectedDocument`, including `settingsRevision`. Refresh the target after document/settings changes. Editing source never executes it.
6. Print affected object IDs and useful results with `print()` or `Console.WriteLine()`, then verify the requested changes with queries or inspection.

Prefer Python for document scripting; C# uses a RhinoCode script-editor body. Command macros are inline and require the explicit disposable-action exception for mutations. Read [scripting reference](../../reference/rhino-script-boilerplate.md) for templates, patch syntax, source pagination, or diagnostics.

A runtime error can leave partial changes. Inspect before retrying. For uncertain runs, use `rh_script` actions `getRun` and `reconcileRun`; reconciliation never resubmits source. After a host restart, inspect geometry before another run. Geometry Undo does not revert saved source revisions.

## Units and files

Convert physical dimensions to the target document's units before modeling. Distinguish model/layout units and degrees/radians. Display precision is not tolerance; never loosen tolerance to hide failure. Clarify unknown or unitless scale when physical size matters. For GH, check its effective Rhino settings and context mismatch; association can differ from the active Rhino document.

For native file operations:

- Start with `list`, use returned live handles rather than display names, and check capabilities. Use `getSettings` for a specific document; never guess unsupported settings.
- Use fresh state tokens for `save`, `saveAs`, and `close`. For `new`/`open`/`activate`, supply `expectedActiveDocument` as the observed active handle or explicit null. `new`/`open` also require `affectedDocuments` with fresh tokens and unsaved policies for every replaced document, or `[]` if none.
- `close` requires `onUnsaved`. Discard only with existing user authorization. Unnamed saves need absolute destinations; supply `templatePath` when required and `createDirectories` when parent directories are missing.
- File transitions end the editing segment and sit outside geometry Undo. Inspect stages and side effects after failures; reconcile uncertain outcomes before replaying an action.

## Views and GH references

For a one-off standard/named-view screenshot, pass `view` to `rh_capture_view`; `restoreView` defaults to true. Use `rh_view_control` for custom setup or persistent view changes. Save named views only when requested. If capture is unavailable, verify with object queries and script results.

For Rhino-to-GH references, query objects, create the correct geometry param with `gh_apply_graph`, and use its returned short ID as `targetId`. Call `gh_param_rhino` with exactly one source: `rhinoObjectIds` for up to 30 objects, or `rhinoQuery` for bulk sets. `reference` keeps live links; `internalize` stores copies. Honor an explicit choice; otherwise clarify when the distinction matters. Verify with `get`.
