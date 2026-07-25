# `gh_apply_graph` — Atomic New-Graph Builds

Use `gh_apply_graph` to create a complete new Grasshopper subgraph in one synchronous call. It creates components, widgets, script nodes, wires, and groups; runs one solution; and returns short instance IDs plus runtime and overlap validation.

## Canonical workflow

```text
resolve unusual or ambiguous component types if necessary
→ gh_apply_graph once
→ inspect its integrated validation
→ use legacy tools only for surgical repair
```

Do not read a blank canvas merely to obtain IDs. Local `ref` values connect objects within the call, and the result maps each ref to its created short ID. Use `gh_get_canvas` to inspect an existing canvas, selection, or subgraph.

## Input

All arrays are optional, but at least one component, widget, or script is required.

- `components`: `{ ref, type, x, y, name?, preview? }`
- `widgets`: slider, panel, toggle, swatch, scribble, or value-list nodes
- `scripts`: `{ ref, language, x, y, name?, code?, scriptParts?, inputs?, outputs? }`
- `wires`: `{ from: [ref, port], to: [ref, port] }`
- `groups`: `{ name, refs, color?, border? }`

### Refs and coordinates

- A `ref` is unique within one call and matches `^[A-Za-z][A-Za-z0-9_-]{0,31}$`.
- Every new node requires `x` and `y`, each at least `20`.
- Refs are local input labels, not persistent canvas IDs.

### Component types

`type` accepts:

- an exact canonical component name;
- `plugin/name` when exact names collide;
- a short type GUID previously returned by Hopper;
- a full type GUID.

Name matching is case-insensitive and exact, never fuzzy. Missing or ambiguous names return candidate information before canvas mutation. Use `gh_list_components` only when a type is unusual, missing, or ambiguous.

### Wires

A port selector is a zero-based index or exact, case-sensitive port name/nickname. `from` always resolves an output; `to` always resolves an input. Both endpoint refs must name nodes in the same call.

### Widgets

- Slider `digits` defaults to `2`.
- Panel `textOutput` defaults to `singleString`.
- New regular components default to `preview: false`.

### Scripts

- New C# node in a graph: use `scriptParts` when possible; `code` remains supported.
- New Python node in a graph: pass the full script in `code`.
- Edit code on an existing node: use `gh_edit_script`.
- Change ports only on an existing node: use `gh_edit_param`.

For C#, `scriptParts` contains namespace `references`, the complete `runScript` method, and optional `helpers`. Hopper assembles the class wrapper. Script port type hints are `object`, `double`, `int`, `string`, or `bool`.

## Atomicity and validation

Hopper resolves all component types and validates refs, coordinates, sources, and graph references before sending the request. On the Grasshopper UI thread it snapshots the document, creates all objects, resolves ports, connects without per-wire solutions, creates groups, then runs one solution.

Invalid types, refs, ports, groups, or exceptions leave the starting canvas unchanged — the document is snapshotted before any mutation, and a mid-graph failure restores it (best-effort restoring the original if the restore itself is interrupted, so the canvas is not left empty). Runtime component messages do not roll back a structurally valid graph; they are returned with overlap data for repair.

A successful **standalone** apply records one Grasshopper undo step, so a single Undo restores the canvas to before the build. When the apply runs **inside an agent turn**, the turn-level transaction already owns the single undo step for the whole turn, so the apply does not record a nested step (one Undo still restores the entire turn). The apply never emits more than one undo record.

If the apply does not finish within the 30-second Grasshopper UI-thread window, the result is `ok: false, timedOut: true` — the canvas outcome is **unknown**, because the work may still complete on the UI thread after the response is sent. Treat this as unknown, not as a clean failure: inspect the canvas (`gh_get_canvas`) and remove any partial result before re-applying, otherwise a retry can duplicate the graph.

## Result

The compact result reports:

- `ok`, `rolledBack`, and `timedOut`;
- created counts by kind;
- local ref → short instance ID mappings;
- structural failures;
- runtime messages and overlap validation;
- elapsed milliseconds.

It does not emit a job ID or success line for every object.

## Surgical follow-up

Use returned short IDs directly with legacy edit tools when a small repair is needed. Rebuild with `gh_apply_graph` only when replacing the whole new subgraph is clearer than a surgical edit.
