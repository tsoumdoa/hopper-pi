# Hopper CLI feedback

## Test

I used Hopper to build an Aurora Vortex Tower in a live Grasshopper document. The definition had a 400-vertex twisted mesh, 384 panels, 16 helical ribs, nine contour rings, eight sliders, grouped components, a canvas note, and a C# script component.

Final checks found no Grasshopper runtime errors or canvas overlaps. The viewport capture is here:

`~/Library/Application Support/hoppercode/sessions/hs_01M05BBMPTNY6JR4NMPK3D25SC/artifacts/artifact_127cf598bed0dc37de02627f-rhino-view.png`

## What worked

- `hopper status` and `hopper plugin doctor` made connection problems easy to diagnose.
- The catalog and schemas made operations discoverable.
- Batch component creation and wire editing were fast and reliable once IDs were known.
- Canvas inspection exposed component state, scripts, ports, and wires.
- Runtime-error, overlap, and viewport checks worked well for final QA.
- Session history recorded useful diffs for commands that returned valid responses.

## Problems

### 1. `gh_apply_graph` rejects wires locally

An atomic graph payload with wires failed with `Unknown type`. The wire schema uses draft 2020-12 `prefixItems`, which TypeBox's runtime `Value.Errors` visitor does not support. This blocks the documented apply-once workflow for wired graphs.

### 2. Applied mutations can be reported as failures

Several commands changed the live document but failed response validation:

- A wire-free `gh_apply_graph` created a slider, but its response omitted `counts`, `refs`, `runtimeMessages`, and `overlaps`.
- `gh_edit_script` created a valid C# component, then returned `Operation "gh_edit_script" returned non-JSON data.`
- Camera and zoom commands changed the Rhino view, then failed validation around `metadata`.

These are dangerous failures because retrying can duplicate work.

### 3. Errors hide the useful details

Messages such as `Unknown type`, `malformed error`, and `non-JSON data` omit the failing input path and raw response shape. They do not tell the caller whether the backend rolled back or applied the mutation.

### 4. History cannot reconcile failed-but-applied edits

When response parsing fails after a mutation, the journal records a failure without an after-checkpoint or diff. The caller must inspect the canvas manually before retrying.

## Suggested fixes

1. Use separate schemas for tool exposure and runtime validation, or add runtime support for `prefixItems`.
2. Normalize every plugin response into one JSON envelope before output validation, including `applyGraph`, `gh_edit_script`, viewport operations, and exception paths.
3. Include the failing input path, backend error code, and sanitized response shape in CLI errors.
4. Capture or inspect the canvas after response-parsing failures so history can record mutations that were applied.
5. Add plugin integration tests for every mutation and validate the full CLI response, not only TypeScript mocks.

## Summary

Hopper can build a substantial parametric definition, and its low-level operations are useful. The weak point is the boundary between plugin responses, CLI normalization, and published schemas. Until those agree, callers should inspect the live canvas after a reported mutation failure before retrying.
