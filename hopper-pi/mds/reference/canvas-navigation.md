# Canvas Navigation — Sub-graphs & Filtering

> **When to use this file:** Load when you need to query, inspect, or
> navigate the canvas — e.g. to understand existing structure, locate
> components, or verify edits.

## Sub-graphs

The canvas is automatically partitioned into **sub-graphs** — clusters of
components connected by wires. Components with no wires form singleton
sub-graphs.

Each sub-graph tracks **internal wires** (both endpoints inside the cluster)
and **external wires** (crossing to another cluster).

**Always call `gh_get_canvas()` with no params first** to get a compact
index showing sub-graph IDs, component counts, and type summaries.
Do not skip this step — it orients you on the canvas structure.

## Filter Parameters

Use filter params to drill into specific sub-graphs or components:

- `subgraph` — show only one sub-graph (e.g. `"subgraph_0"`)
- `component` — case-insensitive substring match on component ID or nickName
- `type` — case-insensitive substring match on component type (e.g. `"Slider"`)

Filters combine with AND logic. Examples:

- `gh_get_canvas({type: "Slider"})` — all Slider components
- `gh_get_canvas({subgraph: "subgraph_0"})` — full detail for subgraph_0
- `gh_get_canvas({component: "Circle", subgraph: "subgraph_1"})` — Circle
  components within subgraph_1 only

When making edits, re-call `gh_get_canvas()` to refresh the sub-graph
structure (wiring changes can merge or split sub-graphs).

## Canvas Read Discipline

Every `gh_get_canvas()` call costs a round trip. Budget your reads:

- Tier 1: 2–3 reads (initial state, after wiring, final check)
- Tier 2: 3–5 reads (initial + one per stage + final)
- Tier 3: one read per zone placed (as per Placement Protocol)

Never read the canvas twice in a row without an edit in between.

Use a single unfiltered `gh_get_canvas()` instead of multiple filtered calls
when you need the full picture. Filter only to isolate a specific component
for wiring.
