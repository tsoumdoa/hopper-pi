# 🦘 Hopper Pi — Grasshopper Canvas Tools for Pi

A **Pi extension** that gives the AI agent direct access to inspect and edit a **Grasshopper canvas** running inside **Rhino**, via **ZeroMQ**. No CLI subprocess — the agent calls tools that speak ZMQ straight to the Rhino backend.

> **What this means in practice:** You can open Pi, load this extension, and ask the agent things like *"add a Circle component at (0, 0), connect it to a Number Slider, set the slider to 12.5"* — and it will actually happen on your Grasshopper canvas.

---

## Prerequisites

1. **Rhino 7+ / Grasshopper** running with the **rhino-zmq-poc** plugin loaded
2. **Pi** installed (`@earendil-works/pi-coding-agent`)
3. **Node.js** ≥ 18 + **pnpm**

### Backend (Rhino side)

The `rhino-zmq-poc` plugin must be running inside Rhino/Grasshopper. It opens three ZMQ ports:

| Socket | Port | Default Endpoint | Purpose |
|--------|------|------------------|---------|
| PUB    | 5555 | `tcp://localhost:5555` | Publishes events (job status, XML snapshots) |
| PULL   | 5556 | `tcp://localhost:5556` | Receives commands (edit actions) |
| REP    | 5557 | `tcp://localhost:5557` | Replies to queries (canvas state, component list) |

All endpoints are configurable via environment variables (see [Configuration](#configuration)).

---

## Installation

```bash
# Clone or navigate to the project
cd hopper-pi

# Install dependencies
pnpm install

# Build (validates TypeScript)
pnpm run build
```

---

## Usage

### Quick start — dev mode with `-e` flag

The fastest way to test during development:

```bash
pi -e ./src/index.ts
```

This tells Pi to load `src/index.ts` as an extension directly from source (no build step needed — Pi uses jiti for on-the-fly TypeScript execution).

### Install as a local extension (project-level)

Copy or symlink into Pi's auto-discovery path:

```bash
mkdir -p .pi/extensions
ln -s $(pwd)/src/index.ts .pi/extensions/hopper-pi.ts

# Then start pi normally — it auto-discovers .pi/extensions/
pi
```

### Install as a global extension

```bash
mkdir -p ~/.pi/agent/extensions
ln -s $(pwd)/src/index.ts ~/.pi/agent/extensions/hopper-pi.ts
```

Global extensions are available in every Pi session, regardless of project.

### Hot-reload while developing

If you use the auto-discovery paths (`~/.pi/agent/extensions/` or `.pi/extensions/`), you can reload without restarting Pi:

- Press `/reload` inside Pi, or
- The extension picks up changes on next session start

---

## Available Tools (14)

Once loaded, the agent has **14 tools** registered. They fall into two groups:

### Query Tools (REQ → REP pattern)

These send a request to port 5557 and wait for a response.

| Tool | Parameters | What it does |
|------|-----------|--------------|
| `gh_get_canvas` | _(none)_ | Fetches the full Grasshopper canvas as parsed JSON. Populates an internal cache with all components, wires, ports, values, positions. **Always call this first before editing.** |
| `gh_list_components` | `filter?` (optional string) | Lists every registered Grasshopper component type (name, GUID, category, subcategory, description). Use this to find the correct GUID when adding new components. Supports optional text search filter. |

### Edit Tools (PUSH → SUB ack pattern)

These publish a command to port 5556 and wait for a job-queued acknowledgment on port 5555.

| Tool | Parameters | What it does |
|------|-----------|--------------|
| `gh_add_component` | `componentType`, `x`, `y`, `nickName?` | Adds a new component to the canvas at the given position |
| `gh_delete_component` | `targetId` | Removes a component by its ID |
| `gh_connect_wire` | `fromComponent`, `fromPort`, `toComponent`, `toPort` | Connects an output port to an input port (port GUIDs required) |
| `gh_disconnect_wire` | `fromComponent`, `fromPort`, `toComponent`, `toPort` | Removes a wire between two ports |
| `gh_move_component` | `targetId`, `x`, `y` | Moves a component to a new canvas position |
| `gh_rename_component` | `targetId`, `nickName` | Changes a component's nickname |
| `gh_set_locked` | `targetId`, `locked` (bool) | Locks or unlocks a component |
| `gh_set_hidden` | `targetId`, `hidden` (bool) | Shows or hides a component |
| `gh_add_group` | `componentIds` (comma-separated), `groupName` | Groups components under a named group |
| `gh_remove_from_group` | `componentIds` (comma-separated), `groupName` | Removes components from a group |
| `gh_set_slider_value` | `targetId`, `value` (number) | Sets a Number Slider's current value |
| `gh_set_panel_text` | `targetId`, `text` | Sets a Panel component's text content |

### Slash Command

| Command | What it does |
|---------|-------------|
| `/gh-refresh` | Manually re-fetches the canvas snapshot from the backend and updates the internal cache |

---

## How the Agent Uses It — Typical Workflow

A natural conversation looks like this:

```
You:   Look at my Grasshopper canvas and tell me what's on it

Agent: [calls gh_get_canvas]
       I see 3 components:
         - Circle (guid=abc123) at (10, 20)
           inputs: [Plane, Radius]  outputs: [Circle]
         - Number Slider (guid=def456) at (-50, 20)
           type:slider  current:1.0  min:0  max:100
         - Panel (guid=ghi789) at (100, -30)
           type:panel  text:"hello"

You:   Connect the slider to the circle radius, then set it to 42

Agent: [calls gh_connect_wire(from="Number Slider", fromPort="<guid>",
                               to="Circle", toPort="<guid>")]
       [calls gh_set_slider_value(targetId="Number Slider", value=42)]
       Done. The slider is now connected to the Circle radius and set to 42.
```

Key points:
- **`gh_get_canvas` populates a cache** — subsequent tool calls can resolve fuzzy names like "Number Slider" to real GUIDs automatically
- **Canvas context is auto-injected** — after the first `gh_get_canvas`, every agent turn receives a summary of the cached canvas as context, so the agent doesn't forget what's on screen
- **The agent figures out port GUIDs** from the cached component data (each input/output port carries its GUID)

---

## Architecture

```
hopper-pi/src/
├── index.ts                  ← Extension entry point (default export)
│                                    Registers all 14 tools
│                                    Hooks session_start, before_agent_start
│                                    Registers /gh-refresh command
│
├── infra/                    ← ZeroMQ transport layer
│   ├── connection.ts        ← Endpoint config + env overrides
│   ├── requester.ts         ← REQ socket client (for queries)
│   ├── publisher.ts         ← PUSH socket client (for commands)
│   ├── subscriber.ts        ← SUB socket client (for job ACKs)
│   └── request-helpers.ts   ← connect/request/close lifecycle helper
│
├── types/                    ← Schemas & domain types
│   ├── messages.ts          ← GhMessage, GhJobStatus, GhEventXml,
│   │                            ListAllComponentsResponse, GetCurrentCanvasResponse
│   ├── commands.ts          ← Command, CommandAction, params, SubmitJobRequest
│   ├── gh.ts                ← Component, Wire, InputPort, OutputPort,
│   │                            ParsedGrasshopper, Visuals, ComponentValue, ...
│   ├── parser.ts            ← XML parser intermediate types
│   └── job.ts               ← Job tracking type
│
├── domain/
│   └── commands.ts          ← ACTION_REGISTRY (all 12 action definitions)
│
├── services/
│   └── parser.ts            ← Grasshopper XML archive → ParsedGrasshopper JSON
│                              (full parser adapted from terminal-tui reference impl.)
│
├── canvas/
│   └── cache.ts             ← Canvas state cache singleton + resolution helpers:
│                              resolveComponentId(), resolveInputPortGuid(),
│                              resolveOutputPortGuid(), searchComponents(), summarize()
│
└── tools/                    ← Pi tool definitions
    ├── query-tools.ts        ← gh_get_canvas, gh_list_components
    ├── edit-tools.ts         ← 12 edit tools (add/delete/connect/move/rename/...)
    └── index.ts              ← ALL_TOOLS array + re-exports
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
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │  REQ     │ │  PUSH    │ │  SUB     │
        │  :5557   │ │  :5556   │ │  :5555   │
        └────┬─────┘ └────┬─────┘ └────┬─────┘
             │             │            │
             ▼             ▼            ▼
        ┌─────────────────────────────────┐
        │      rhino-zmq-poc (Rhino)      │
        │      Grasshopper backend         │
        └─────────────────────────────────┘
```

### Query flow (e.g., `gh_get_canvas`)
1. Tool creates a `Requester`, connects to `tcp://localhost:5557`
2. Sends `{ type: "getCurrentCanvas" }` as JSON
3. Receives `{ type: "getCurrentCanvas.response", xml: "..." }`
4. Parses XML → `ParsedGrasshopper` via `buildGhJson()`
5. Stores result in `canvasCache` singleton
6. Returns formatted summary to the agent

### Edit flow (e.g., `gh_add_component`)
1. Tool builds a `SubmitJobRequest` with a unique `jobId` (nanoid)
2. Creates a `Publisher`, connects to `tcp://localhost:5556`
3. Sends the command as JSON
4. Creates a `Subscriber`, connects to `tcp://localhost:5555`
5. Subscribes to `gh.job.status` topic
6. Waits up to `COMMAND_ACK_TIMEOUT_MS` (default 5s) for a `queued` status matching our `jobId`
7. Returns jobId/commandId confirmation to the agent

---

## Configuration

All ZMQ endpoints are configurable via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `GH_ZMQ_PUB` | `tcp://localhost:5555` | PUB/SUB endpoint for events |
| `GH_ZMQ_PUSH` | `tcp://localhost:5556` | PUSH/PULL endpoint for commands |
| `GH_ZMQ_REQ` | `tcp://localhost:5557` | REQ/REP endpoint for queries |
| `GH_ACK_TIMEOUT_MS` | `5000` | Max wait (ms) for command ACK from backend |
| `GH_DEBUG` | _(unset)_ | Set to `"1"` for verbose ZMQ logging |

Example:

```bash
GH_ZMQ_REQ=tcp://192.168.1.100:5557 GH_DEBUG=1 pi -e ./src/index.ts
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

### Project structure vs. reference projects

This extension adapts code from two sibling projects:

| This module (`hopper-pi`) | Source of truth |
|---------------------------|-----------------|
| `infra/*` transport layer | `terminal-tui/src/infra/*` |
| `types/*` schemas | `terminal-tui/src/types/*` |
| `domain/commands.ts` registry | `terminal-tui/src/domain/commands.ts` |
| `services/parser.ts` XML parser | `terminal-tui/src/services/parser.ts` |
| `canvas/cache.ts` resolution helpers | **New** — built for agent use case |
| `tools/*` Pi tool definitions | **New** — wraps ZMQ calls as `defineTool()` calls |
| `index.ts` extension entry point | **New** — replaces old `run-once` harness |

**Key difference from `terminal-tui`:** The CLI was a human-facing interactive shell (readline prompts, Commander.js). This extension exposes the same backend communication as **agent-callable tools** — no subprocess spawning, no text UI, direct ZMQ from within the Pi tool execution pipeline.

### Dependencies

| Package | Purpose |
|---------|---------|
| `@earendil-works/pi-coding-agent` | Pi extension API (`ExtensionAPI`, `defineTool`, events) |
| `@earendil-works/pi-ai` | `Type.String()`, `Type.Object()` etc. for tool parameter schemas |
| `zeromq` | ZeroMQ sockets (Request, Push, Subscriber) |
| `fast-xml-parser` | Grasshopper XML archive parsing |
| `nanoid` | Unique job ID generation |
| `chalk` | Terminal colors (available, used sparingly) |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| "Cannot connect to Grasshopper" | Rhino not running, or plugin not loaded | Start Rhino with rhino-zmq-poc plugin; check ports |
| Tools return but nothing changes on canvas | Command sent but not processed | Check SUB socket for job status; increase `GH_ACK_TIMEOUT_MS` |
| Agent can't find component IDs | Canvas cache empty | Agent must call `gh_get_canvas` first |
| Port GUID resolution fails | Stale cache | Run `/gh-refresh` to re-fetch canvas |
| `ECONNREFUSED` on all ports | ZMQ endpoints not listening | Verify `GH_ZMQ_*` env vars match plugin config |
