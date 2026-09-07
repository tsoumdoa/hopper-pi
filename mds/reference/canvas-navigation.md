# Inspecting the canvas

Use `gh_get_canvas` for existing structure or selection. New builds return IDs and validation through [gh_apply_graph](./apply-graph.md).

| Filter | Scope |
|--------|-------|
| `subgraph` | One cluster, using an ID returned by the current canvas summary |
| `selectionOnly: true` | Selected objects; selected groups expand to members |

```json
{"selectionOnly":true}
```

Subgraph labels describe the current canvas organization. Discover them before filtering; do not assume an earlier `subgraph_0` still identifies the intended objects. Inspect boundary wires when editing a subset.
