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

## Filter Parameters

Use filter params to drill into specific sub-graphs or components:

- `subgraph` — show only one sub-graph (e.g. `"subgraph_0"`)

Examples:

- `gh_get_canvas({subgraph: "subgraph_0"})` — full detail for subgraph_0

## Canvas Read Discipline — HARD RULES

### MANDATORY: Place first, read once

`gh_get_canvas` is **expensive** and must be treated as a scarce resource.
The workflow is:

> **Place ALL components → `gh_get_canvas` once → wire everything → done**

**You MUST add all components needed for the function you are building BEFORE
calling `gh_get_canvas`.** Do not call it before all components are on the
canvas. The only purpose of `gh_get_canvas` is to get component and port
GUIDs so you can wire things up and verify the build succeeded.

### When `gh_get_canvas` is allowed

1. **After all components are placed** — to get GUIDs for wiring. This is
   the primary and expected use. Call once, get every GUID you need, then
   batch all wiring.
2. **Debugging errors** — something went wrong after wiring and you need
   to inspect the current state. Prefer `gh_get_canvas_errors` for
   error/warning info first.

### When `gh_get_canvas` is NOT allowed

- **Before all components are placed.** You know what you're building —
  place it all first.
- **To "orient yourself" on the canvas.** You don't need an orientation
  call. Start placing components.
- **To verify components you just placed.** You placed them — you already
  know their positions.
- **Between zones during placement.** Place all zones, then read once.
- **Twice in a row without an edit in between.**

### Read budget: 1 read per build cycle

Every build cycle gets **one** `gh_get_canvas` call — after all components
are placed, before wiring. Additional reads are only allowed when debugging
errors that cannot be diagnosed with `gh_get_canvas_errors` alone.

When you do call `gh_get_canvas`, use a single unfiltered call instead of
multiple filtered calls. Filter only to isolate a specific component when you
need a single GUID and already know the component name.
