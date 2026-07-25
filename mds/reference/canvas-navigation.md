# Canvas Navigation — Sub-graphs & Filtering

> **When to use:** Query or inspect an existing canvas, selection, or subgraph. New graphs should use [`gh_apply_graph`](./apply-graph.md) local refs and integrated validation.

## Sub-graphs

The canvas is partitioned into **sub-graphs** — wired clusters. Unwired components are singleton sub-graphs. Each sub-graph has **internal wires** (both ends inside) and **external wires** (crossing clusters).

## Filter parameters

| Param | Purpose |
|-------|---------|
| `subgraph` | Detail for one cluster, e.g. `"subgraph_0"` |
| `selectionOnly` | Detail for current canvas selection only (groups expand to members). |

**Examples:**

- `gh_get_canvas({ subgraph: "subgraph_0" })`
- `gh_get_canvas({ selectionOnly: true })`

Do not use `gh_get_canvas` to recover IDs after a new graph build; `gh_apply_graph` returns ref-to-short-ID mappings. Filter only when isolating existing structure or a user selection.
