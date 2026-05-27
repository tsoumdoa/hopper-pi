# Hopper Pi — Grasshopper Canvas Tools for Pi

A **Pi extension** that gives the AI agent direct access to inspect and edit a **Grasshopper canvas** running inside **Rhino**, via **ZeroMQ**. The agent calls tools that speak ZMQ straight to the Rhino backend — no CLI subprocess.

> **What this means in practice:** You can open Pi, load this extension, and ask the agent things like _"add a Circle component at (100, 50), connect it to a Number Slider, set the slider to 12.5"_ — and it will actually happen on your Grasshopper canvas.

---

## Prerequisites

1. **Rhino 7+ / Grasshopper** running with the **rhino-zmq-poc** plugin loaded
2. **Pi** installed (`@earendil-works/pi-coding-agent`)
3. **Node.js** >= 18 + **pnpm**

### Backend (Rhino side)

The `rhino-zmq-poc` plugin must be running inside Rhino/Grasshopper. It opens three ZMQ ports:

| Socket | Port | Default Endpoint       | Purpose                                           |
| ------ | ---- | ---------------------- | ------------------------------------------------- |
| PUB    | 5555 | `tcp://localhost:5555` | Publishes events (job status, XML snapshots)      |
| PULL   | 5556 | `tcp://localhost:5556` | Receives commands (edit actions)                  |
| REP    | 5557 | `tcp://localhost:5557` | Replies to queries (canvas state, component list) |

All endpoints are configurable via environment variables (see [Configuration](#configuration)).

---

## Installation

```bash
cd hopper-pi

pnpm install

pnpm run build
```

---

## Usage

### Quick start — dev mode with Pi

The `package.json` includes a `"pi"` config that tells Pi where to find the extension, skills, and prompts:

```bash
pnpm run pi
```

This runs `pi -e .`, which loads the extension entry point (`src/index.ts`) plus any skills and prompts from the `mds/` directory.

### Manual dev mode

```bash
pi -e ./src/index.ts
```

Pi uses jiti for on-the-fly TypeScript execution, so no build step is needed during development.

### Build (type-check)

```bash
pnpm run build
```

Outputs to `dist/` with source maps. Not required for `pi -e` usage, but useful for type-checking.

---

## Available Tools (9)

The extension registers **9 tools** — 3 query tools and 6 consolidated edit tools. Each edit tool accepts an `items` array for batch processing.

### Query Tools (REQ/REP pattern)

These send a request to port 5557 and wait for a response.

| Tool                   | Parameters                                                                                                                    | What it does                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gh_get_canvas`        | _(none)_                                                                                                                      | MANDATORY: place ALL components before calling. Call once after all are placed to get GUIDs for wiring and verify the build. Do NOT call before placement or between zones.                                                                                                                                                                                                                                           |
| `gh_list_components`   | `queries[]` (string array), `searchFrom?` (`"vanilla"` \| `"plugin"` \| `"params"`, default `"vanilla"`), `limit?`, `offset?` | Searches registered Grasshopper component types by keyword. Returns results grouped by category/subcategory with typeGuids for use as `componentType` in `gh_edit_components`. `searchFrom` controls the source: `"vanilla"` (default) = built-in GH excluding Params; `"plugin"` = plugin components only; `"params"` = Params category only. Supports batch queries and pagination (`hasMore`, `totalMatched`). |
| `gh_get_canvas_errors` | _(none)_                                                                                                                      | Retrieves all runtime errors, warnings, and messages from the canvas. Also runs an overlap detection check to find visually overlapping components and groups.                                                                                                                                                                                                                                                        |

### Edit Tools (PUSH/fire-and-forget pattern)

These publish commands to port 5556 and return immediately with a jobId for each operation.

| Tool                 | Key actions                                                                                                                                            | What it does                                                                                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gh_edit_components` | `add`, `delete`, `move`, `rename`, `set_locked`, `set_hidden`                                                                                          | Unified component operations. Components are added with preview disabled by default (`preview: false`); set `preview: true` to enable viewport preview. Use `gh_get_canvas` for instance GUIDs, `gh_list_components` for component typeGuids.              |
| `gh_edit_param`      | `listParams`, `addInput`, `removeInput`, `addOutput`, `removeOutput`, `editAccessType`                                                                 | Manage input/output ports on script components. List current params, add/remove ports, change access type (item/list/tree), set data mapping (flatten/graft), simplify/reverse flags. `editAccessType` works on both inputs and outputs for data mapping properties. |
| `gh_edit_wire`       | `connect`, `disconnect`                                                                                                                                | Connect or disconnect wires between component ports. Requires COMPONENT_GUID and PORT_GUID values from `gh_get_canvas` output.                                                                                                                                       |
| `gh_edit_group`      | `add`, `remove`, `delete`, `changeColor`, `rename`, `changeStyle`                                                                                      | Group operations. Supports color (rgba), border style (Box/Blob/Rectangles), and batch operations.                                                                                                                                                                   |
| `gh_create_widget`   | slider, panel, toggle, swatch, scribble, valueList                                                                                                     | Create Grasshopper UI widgets at a canvas position. Each type has its own required fields.                                                                                                                                                                           |
| `gh_mutate_widget`   | slider: `setValue`, `setRange`; panel: `setText`, `setProperty`; toggle: `setValue`; swatch: `setColor`; scribble: `setText`; valueList: `setSelected` | Modify existing widgets by targetId.                                                                                                                                                                                                                                 |
| `gh_edit_script`     | `create`, `setCode`, `getCode`                                                                                                                         | Script node operations. Create C# or Python script nodes with source code and I/O parameters. Get or set source code on existing scripts. Language is set at creation and cannot be changed.                                                                         |

---

## How the Agent Uses It — Typical Workflow

```
You:   Connect the slider to the circle radius, then set it to 42

Agent: [calls gh_get_canvas]  ← only because it needs GUIDs for wiring
       I see 3 components:
         - Circle (COMPONENT_GUID=abc123) at pivot (10, 20)
           OUTPUTS: Circle (PORT_GUID=xyz789)
           INPUTS: Plane (PORT_GUID=...), Radius (PORT_GUID=...)
         - Number Slider (COMPONENT_GUID=def456)
           slider: min=0 max=100 current=1.0
         - Panel (COMPONENT_GUID=ghi789)
           panel: "hello"

       [calls gh_edit_wire(items: [{ action: "connect", fromComponent: "def456",
                                    fromPort: "<output-port-guid>",
                                    toComponent: "abc123", toPort: "<input-port-guid>" }])]
       [calls gh_mutate_widget(items: [{ widgetType: "slider", action: "setValue",
                                        targetId: "def456", value: 42 }])]
       Done. The slider is now connected to the Circle radius and set to 42.
```

### Batch processing

All edit tools accept an `items` array. Instead of calling a tool multiple times, pass all operations in one call:

```
You:   Delete these 3 components and hide that panel

Agent: [calls gh_edit_components(items: [{ action: "delete", targetId: "abc123" },
                                         { action: "delete", targetId: "def456" },
                                         { action: "delete", targetId: "ghi789" }])]
       [calls gh_edit_components(items: [{ action: "set_hidden", targetId: "jkl012", hidden: true }])]
```

Key points:

- **`gh_get_canvas` populates the GUID shortener** — component and port GUIDs are returned as short base62 aliases, and edit tools automatically resolve them back to full GUIDs before sending commands. But only call after all components are placed — one call per build cycle.
- **`gh_list_components` returns typeGuids** — each component's typeGuid can be used as `componentType` in `gh_edit_components`. Use `searchFrom` to filter by source: `"vanilla"`, `"plugin"`, or `"params"`.
- **GUID resolution via guid-shortener** — hash-based short GUID resolution via `guid-shortener` (SHA-256 + base62).
- **Canvas errors include overlap detection** — `gh_get_canvas_errors` reports both runtime errors/warnings and any components that visually overlap on the canvas

---

## Architecture

```
hopper-pi/src/
├── index.ts                  Extension entry point (default export)
│                              Registers all 9 tools
│                              Hooks session_start for load notification
│
├── infra/                    ZeroMQ transport layer
│   ├── connection.ts        Endpoint config + env overrides
│   ├── requester.ts         REQ socket client (for queries)
│   ├── publisher.ts         PUSH socket client (for commands, cached singleton)
│   ├── subscriber.ts        SUB socket client (for event streaming)
│   └── request-helpers.ts   connect/request/close lifecycle helper
│
├── types/                    Schemas & domain types
│   ├── messages.ts          GhMessage, GhJobStatus, GhEventXml,
│   │                            ListAllComponentsResponse, GetCurrentCanvasResponse,
│   │                            GetCanvasErrorsResponse, CanvasError,
│   │                            ListScriptParamsResponse, GetScriptCodeResponse
│   ├── commands.ts          CommandAction (39 action types), Command,
│   │                            SubmitJobRequest, per-action param types
│   ├── gh.ts                Component, Wire, InputPort, OutputPort,
│   │                            ParsedGrasshopper, Visuals, ComponentValue, ...
│   ├── parser.ts            XML parser intermediate types
│   └── job.ts               Job tracking type
│
├── services/
│   ├── parser.ts            Grasshopper XML archive → ParsedGrasshopper JSON
│   ├── guid-shortener.ts    SHA-256 + base62 GUID shortening/resolution
│   │                              toShortInstanceGuid(), toShortTypeGuid(),
│   │                              resolveInstanceGuid(), resolveTypeGuid()
│   └── component-registry.ts Per-call sequential number → typeGuid mapping
│
├── tools/                    Pi tool definitions + shared logic
│   ├── index.ts             ALL_TOOLS array (9 tools) + re-exports
│   ├── query-tools.ts       gh_get_canvas, gh_list_components, gh_get_canvas_errors
│   ├── query-handlers.ts    Fetch + format logic for query tools
│   ├── edit-handlers.ts     createExecute() / createHybridExecute() factories,
│   │                            submitCommand(), buildJobRequest()
│   ├── canvas-checks.ts     Component/group overlap detection
│   ├── constants.ts         Excluded type GUIDs, vanilla categories, blacklisted subcategories
│   └── edit-tools/          Individual edit tool definitions
│       ├── index.ts         Re-exports all 6 edit tools
│       ├── shared-types.ts  Reusable TypeBox schemas (SliderCreateFields, etc.)
│       ├── gh-edit-components.ts
│       ├── gh-edit-param.ts
│       ├── gh-edit-wire.ts
│       ├── gh-edit-group.ts
│       ├── gh-edit-widget.ts
│       └── gh-edit-script.ts
```

### Bundled skills & reference materials

The `mds/` directory ships supplementary content loaded by Pi:

```
hopper-pi/mds/
├── skills/
│   └── gh-modeling-expert/   Skill definition for Grasshopper modeling expertise
└── reference/
    ├── csharp-boilerplate.md   C# script boilerplate for Grasshopper
    ├── python-boilerplate.md   Python script boilerplate for Grasshopper
    └── layout-system.md        Layout system reference
```

These are declared in `package.json` under the `"pi"` config:

```json
{
  "pi": {
    "extensions": ["./src/index.ts", "./mds/extensions"],
    "skills": ["./mds/skills", "./mds/agents"],
    "prompts": ["./mds/prompts"]
  }
}
```

### Data flow

```
                    ┌─────────────┐
                    │   Pi Agent  │
                    │  (LLM loop) │
                    └──────┬──────┘
                           │ tool calls
                    ┌──────▼──────┐
                    │  hopper-pi  │  ← this extension
                    │   tools     │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼                         ▼
        ┌──────────┐              ┌──────────┐
        │  REQ     │              │  PUSH    │
        │  :5557   │              │  :5556   │
        └────┬─────┘              └────┬─────┘
             │                         │
             ▼                         ▼
        ┌──────────────────────────────────────┐
        │      rhino-zmq-poc (Rhino)           │
        │      Grasshopper backend              │
        └──────────────────────────────────────┘
```

### Query flow (e.g., `gh_get_canvas`)

1. Tool calls `withRequester()` — creates a `Requester`, connects to `tcp://localhost:5557`
2. Sends `{ type: "getCurrentCanvas" }` as JSON
3. Receives `{ type: "getCurrentCanvas.response", xml: "..." }`
4. Parses XML → `ParsedGrasshopper` via `buildGhJson()`
5. Shortens all GUIDs via `guid-shortener` (SHA-256 → base62, 10-char aliases)
6. Returns formatted text with `[id]`, `COMPONENT_GUID=`, and `PORT_GUID=` markers

### Edit flow (e.g., `gh_edit_components`)

1. Tool receives an `items` array of operation objects
2. For each item, the tool-specific mapper converts it to a `{ action, params }` pair. For `add`, the typeGuid from `gh_list_components` is resolved via `resolveTypeGuid()`, and instance short GUIDs are resolved via `resolveInstanceGuid()`
3. `buildJobRequest()` wraps each command with a unique `jobId` (nanoid)
4. `submitCommand()` gets the cached `Publisher`, connects to `tcp://localhost:5556`, sends the JSON command
5. Returns jobId immediately (fire-and-forget — no ACK wait)

### Hybrid flow (e.g., `gh_edit_script`, `gh_edit_param`)

Some tools support both query and mutation actions in a single `items` array:

- Query items (e.g., `getCode`, `listParams`) are routed through `withRequester()` for REQ/REP
- Mutation items are routed through the standard `createExecute()` edit path
- Results from both paths are merged into a single response

---

## Configuration

All ZMQ endpoints are configurable via environment variables:

| Variable      | Default                | Description                          |
| ------------- | ---------------------- | ------------------------------------ |
| `GH_ZMQ_PUB`  | `tcp://localhost:5555` | PUB/SUB endpoint for events          |
| `GH_ZMQ_PUSH` | `tcp://localhost:5556` | PUSH/PULL endpoint for commands      |
| `GH_ZMQ_REQ`  | `tcp://localhost:5557` | REQ/REP endpoint for queries         |
| `GH_DEBUG`    | _(unset)_              | Set to `"1"` for verbose ZMQ logging |

Example:

```bash
GH_ZMQ_REQ=tcp://192.168.1.100:5557 GH_DEBUG=1 pi -e .
```

---

## Development

### Build

```bash
pnpm run build
```

Outputs to `dist/` with source maps. Not required for `pi -e` usage (Pi uses jiti), but useful for type-checking.

### Type-check only

```bash
npx tsc --noEmit
```

### Dependencies

| Package                           | Purpose                                                          |
| --------------------------------- | ---------------------------------------------------------------- |
| `@earendil-works/pi-coding-agent` | Pi extension API (`ExtensionAPI`, `defineTool`)                  |
| `@earendil-works/pi-ai`           | `Type.String()`, `Type.Object()` etc. for tool parameter schemas |
| `zeromq`                          | ZeroMQ sockets (Request, Push, Subscriber)                       |
| `fast-xml-parser`                 | Grasshopper XML archive parsing                                  |
| `nanoid`                          | Unique job ID generation                                         |
| `chalk`                           | Terminal colors                                                  |

### Dev dependencies

| Package       | Purpose                                 |
| ------------- | --------------------------------------- |
| `typescript`  | TypeScript compiler                     |
| `tsx`         | TypeScript execution for `pnpm run dev` |
| `@types/node` | Node.js type definitions                |

---

## Troubleshooting

| Symptom                                          | Likely cause                            | Fix                                                      |
| ------------------------------------------------ | --------------------------------------- | -------------------------------------------------------- |
| "Cannot connect to Grasshopper"                  | Rhino not running, or plugin not loaded | Start Rhino with rhino-zmq-poc plugin; check ports       |
| Agent can't find component IDs                   | Canvas not fetched yet                  | Agent must call `gh_get_canvas` first                    |
| Port GUID resolution fails                       | Stale GUID store                        | Call `gh_get_canvas` to re-populate the shortener        |
| `ECONNREFUSED` on all ports                      | ZMQ endpoints not listening             | Verify `GH_ZMQ_*` env vars match plugin config           |
| Tool returns jobId but nothing changes on canvas | Backend not processing commands         | Check Rhino console for errors; verify plugin is running |
