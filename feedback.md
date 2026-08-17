# Hopper CLI live-test feedback

## Test result

I used Hopper to build an Aurora Vortex Tower in a live Grasshopper document. The final definition contained a 400-vertex twisted mesh, 384 panels, 16 helical ribs, nine contour rings, eight sliders, a canvas note, a C# script component, eight wires, and two groups.

The viewport capture is here:

`~/Library/Application Support/hoppercode/sessions/hs_01M05BBMPTNY6JR4NMPK3D25SC/artifacts/artifact_127cf598bed0dc37de02627f-rhino-view.png`

The final live checks reported no Grasshopper runtime errors or canvas overlaps. Those query results were not saved in the journal, so the session files prove the graph structure and failure history but not the final error and overlap counts.

## What worked

- `hopper status` and `hopper plugin doctor` made connection problems easy to diagnose.
- The catalog and schemas made operations discoverable.
- Batch widget creation, wire editing, grouping, canvas inspection, and viewport capture worked.
- Successful mutations produced useful checkpoints and diffs.

## Confirmed problems

### 1. `gh_apply_graph` rejects wires before sending

The public wire schema uses draft 2020-12 `prefixItems`. Runtime validation passes that schema to TypeBox `Value.Errors`, which throws `Unknown type`. A valid one-wire request still reproduces this on the current checkout, so the documented apply-once workflow is blocked for wired graphs.

### 2. Successful mutations can fail response validation

The saved journal confirms two applied mutations that the CLI recorded as failures:

- A wire-free `gh_apply_graph` created a slider, then failed its output contract.
- `gh_edit_script` created a working C# component, then reported non-JSON data.

Both defects remain in the current code, although their exact shapes have changed. The plugin's `ApplyGraphResponse` still omits the required `runtimeMessages` and `overlaps`. A script create result still includes `targetId: undefined`, which fails the registry's JSON check. The camera and zoom failures from the live run now have action-envelope extraction code, but they still need full CLI contract tests against serialized plugin responses.

Retrying after one of these errors can duplicate work because the failure happens after the backend mutation.

### 3. Error reports lose mutation evidence

Schema mismatches can include field paths, but `Unknown type`, `malformed error`, and `non-JSON data` do not include a safe response-shape summary or a reliable statement that the mutation was applied, rolled back, not sent, or left unknown.

### 4. History cannot repair failed-but-applied edits

The CLI captures an after-checkpoint only for `succeeded` or `partial` results. A response-contract failure becomes terminal `failed`, with no after-checkpoint or diff. `history reconcile` then refuses to revisit that terminal edit. The caller must inspect the canvas before retrying.

## Suggested fix plan

### 1. Add full-pipeline regression tests

Run each fixture through `OperationRegistry.execute` and the CLI handlers. Cover a wired `gh_apply_graph`, the actual serialized plugin apply response, `gh_edit_script create`, camera, zoom, and a backend success followed by output-validation failure. Direct operation tests are not enough because they bypass final JSON and schema validation.

### 2. Separate public and runtime input schemas

Keep the published draft 2020-12 schema unchanged. Add a TypeBox-compatible runtime schema that uses tuple validation for wire endpoints, and make `OperationRegistry.resolve` use it. Invalid endpoints should report paths such as `/wires/0/from/1` instead of throwing `Unknown type`.

### 3. Normalize requests and responses at one boundary

- Reuse the existing apply normalization before sending: resolve component names to `typeGuid`, assemble C# `scriptParts`, and shorten returned refs.
- Decode action envelopes through one shared helper.
- Omit optional properties instead of assigning `undefined`.
- Normalize unknown backend error codes while retaining the original code in error details.
- Extend the plugin apply response with real runtime messages and overlap results captured after the solution runs. Do not replace missing diagnostics with empty arrays because that would falsely report a clean graph.

### 4. Preserve mutation evidence in history

If the backend applied a mutation but result validation fails, classify it as `partial_mutation`, preserve `canvasDigestAfter`, capture an after-checkpoint, and record the diff. Add an append-only reconciliation event so stronger backend evidence can correct an earlier terminal classification. Refuse reconciliation when a later canvas edit makes attribution unsafe.

### 5. Add cross-language and live integration gates

Use shared response fixtures that both TypeScript and C# deserialize. Validate the complete CLI response for every mutation. In a Grasshopper-capable job, run the multi-wire, rollback, script, viewport, and history-recovery cases without skipping them.

## Acceptance criteria

- One atomic graph containing components, widgets, a script, wires, and groups succeeds.
- Its response includes valid counts, refs, runtime messages, and overlap data.
- Every operation result is JSON-safe and passes its published output schema.
- A failed response after an applied mutation records an after-checkpoint and diff, and tells the caller whether retrying is safe.
- Retrying the same request ID does not duplicate geometry.
- The relevant Grasshopper integration tests run without skips in the release environment.

## Summary

Hopper completed a substantial live definition, and its low-level operations were useful. The remaining risk is the contract between published schemas, TypeBox validation, CLI result shaping, and serialized plugin responses. Fix that boundary first, then make history preserve evidence whenever the backend may have changed the document.
