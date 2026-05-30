# Canvas Navigation — Sub-graphs & Filtering

> **When to use:** Query or inspect existing canvas structure. For placement workflow and `gh_get_canvas` discipline, see [gh-modeling-expert](../skills/gh-modeling-expert/SKILL.md).

## Sub-graphs

The canvas is partitioned into **sub-graphs** — wired clusters. Unwired components are singleton sub-graphs. Each sub-graph has **internal wires** (both ends inside) and **external wires** (crossing clusters).

## Filter parameters

| Param | Purpose |
|-------|---------|
| `subgraph` | Detail for one cluster, e.g. `"subgraph_0"` |
| `selectionOnly` | Detail for current canvas selection only (groups expand to members). For inspecting user selection — **not** a substitute for the single full read after placing all components in a new build. |

**Examples:**

- `gh_get_canvas({ subgraph: "subgraph_0" })`
- `gh_get_canvas({ selectionOnly: true })`

Use one unfiltered `gh_get_canvas` after placement when you need all GUIDs. Filter only when isolating a known subgraph or selection.
