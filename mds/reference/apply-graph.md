# Creating a subgraph with gh_apply_graph

Create nodes, widgets, scripts, wires, and groups in one call. Hopper runs one solution and returns local-ref mappings, runtime messages, and overlap checks. Use targeted editing tools for existing objects.

## Inputs

At least one component, widget, or script is required. Other arrays are optional.

| Array | Fields |
|-------|--------|
| `components` | `ref`, `type`, `x`, `y`, optional `name`, `preview` |
| `widgets` | `ref`, `kind`, `x`, `y`, and kind-specific fields from the tool schema |
| `scripts` | `ref`, `language`, `x`, `y`, optional `name`, `code` or `scriptParts`, `inputs`, `outputs` |
| `wires` | `from: [ref, port]`, `to: [ref, port]` |
| `groups` | `name`, `refs`, optional `color`, `border` |

- Refs are unique within the call and match `^[A-Za-z][A-Za-z0-9_-]{0,31}$`. They are not persistent canvas IDs.
- `x` and `y` are pivots and must each be at least 20. See [layout](./layout-system.md) for bounds offsets.
- `type` accepts an exact canonical name, `plugin/name`, or a returned short/full type GUID. Names are case-insensitive, with no fuzzy matching. Resolve missing or ambiguous types with `gh_list_components`.
- Wire ports use zero-based indices or exact, case-sensitive names/nicknames. Both endpoint refs must belong to this call. Use returned IDs and `gh_edit_wire` to connect existing nodes.
- Sliders default to `digits: 2`; panels default to `textOutput: "singleString"`. Regular components default to `preview: false`.
- Python scripts use full `code`; C# preferably uses `scriptParts`. See [script lifecycle](./script-component-lifecycle.md) for port definitions and edits.

## Results and failures

The result includes `ok`, `rolledBack`, `timedOut`, counts, ref-to-short-ID mappings, structural errors, runtime messages, overlaps, and elapsed time. Use returned IDs directly; do not reread the canvas just to recover them.

Types and graph structure are checked before execution. Hopper snapshots the GH document before creation and attempts restoration after a structural failure. Check `rolledBack`; restoration can fail. Component runtime errors keep a structurally valid graph in place for repair.

If the 30-second UI-thread window expires, `timedOut: true` means work may still finish after the response. Inspect current state before retrying. Repair or remove only identified failed additions; do not duplicate a completed graph or blindly delete uncertain results.

A standalone apply records one GH Undo step. Inside an agent turn, it shares the turn's Undo step. These guarantees cover the GH document, not external side effects caused by components or scripts.
