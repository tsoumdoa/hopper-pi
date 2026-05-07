# hoppercode

CLI tool for interacting with Grasshopper via ZMQ. Requires the GH ZMQ Plugin component running inside Rhino/Grasshopper.

## Setup

```sh
cd terminal-tui
npm install
npm run build
```

## Commands & Operations

### 1. `subscribe` — Listen to canvas events (PUB/SUB)

Subscribes to the Grasshopper pub/sub event stream. Receives `gh.job.status` (command lifecycle) and `gh.event.xml` (document snapshot) messages in real time.

**Pattern:** PUB/SUB on port **5555**

```sh
# Listen to all events
node dist/index.js subscribe

# Filter by topic prefix
node dist/index.js subscribe --filter gh.job

# Save received XML snapshots to files
node dist/index.js subscribe --save-xml
```

**Output topics:**

| Topic | Type | Description |
|-------|------|-------------|
| `gh.job.status` | `GhJobStatus` | Job state changes: queued → running → completed/failed |
| `gh.event.xml` | `GhEventXml` | Full Grasshopper document XML snapshot on each solution end |

---

### 2. `submit` — Send mutation commands (PUSH/PULL + PUB/SUB ack)

Sends commands to modify the Grasshopper canvas. Uses PUSH/PULL for command delivery and PUB/SUB for asynchronous job-status acknowledgment.

**Pattern:** PUSH/PULL on port **5556** + PUB/SUB ack on **5555**

```sh
# One-shot command via flags
node dist/index.js submit addComponent --componentType Circle --nickName "My Circle" --x 100 --y 200
node dist/index.js submit deleteComponent --targetId "Area_1"
node dist/index.js submit renameComponent --targetId "Panel_1" --nickName "New Name"
node dist/index.js submit moveComponent --targetId "Circle_1" --x 300 --y 400
node dist/index.js submit connectWire --fromComponent "Panel_1" --fromPort "output" --toComponent "Circle_1" --toPort "radius"
node dist/index.js submit disconnectWire --fromComponent "Panel_1" --fromPort "output" --toComponent "Circle_1" --toPort "radius"
node dist/index.js submit setComponentLocked --targetId "Circle_1" --locked true
node dist.index.js submit setComponentHidden --targetId "Circle_1" --hidden false
node dist/index.js submit addGroup --componentIds "Circle_1,Panel_1" --groupName "My Group"
node dist/index.js submit removeFromGroup --componentIds "Circle_1" --groupName "My Group"
node dist/index.js submit setSliderValue --targetId "Slider_1" --value 42.5
node dist/index.js submit setPanelText --targetId "Panel_1" --text "hello world"

# Interactive mode (numbered menu)
node dist/index.js submit
node dist/index.js submit --interactive
```

**Available actions:**

| #  | Action              | Required params                                    |
|----|---------------------|----------------------------------------------------|
| 1  | addComponent        | --componentType, --nickName, --x, --y              |
| 2  | deleteComponent     | --targetId                                         |
| 3  | connectWire         | --fromComponent, --fromPort, --toComponent, --toPort |
| 4  | disconnectWire      | --fromComponent, --fromPort, --toComponent, --toPort |
| 5  | moveComponent       | --targetId, --x, --y                               |
| 6  | renameComponent     | --targetId, --nickName                             |
| 7  | setComponentLocked  | --targetId, --locked (true/false)                  |
| 8  | setComponentHidden  | --targetId, --hidden (true/false)                  |
| 9  | addGroup            | --componentIds (comma-sep), --groupName            |
| 10 | removeFromGroup     | --componentIds (comma-sep), --groupName            |
| 11 | setSliderValue      | --targetId, --value                                |
| 12 | setPanelText        | --targetId, --text                                 |

---

### 3. `diff` — Compare document snapshots (PUB/SUB)

Diffs Grasshopper document XML snapshots between solution ends. On first run it saves a baseline; subsequent runs diff against the previous snapshot.

**Pattern:** PUB/SUB on port **5555**

```sh
# Single diff against last snapshot
node dist/index.js diff

# Continuous watch mode (diff every new snapshot)
node dist/index.js diff --watch
```

Output shows added/removed/changed components, property-level changes (slider values, nicknames, ports, wires), and wire additions/removals. Baseline stored at `~/.gh-diff-baseline.xml`. Delete that file to reset.

---

### 4. `list-components` — List all available component types (REQ/REP)

Queries the Grasshopper component registry and returns every registered component type (what **can** be added to the canvas). Includes name, GUID, category, subcategory, and description for each.

**Pattern:** REQ/REP on port **5557**

```sh
node dist/index.js list-components
```

**Response shape:**
```json
{
  "type": "listAllComponents.response",
  "timestamp": 1700000000000,
  "components": [
    {
      "name": "Circle",
      "guid": "xxxx-xxxx-xxxx-xxxx",
      "category": "Curve",
      "subcategory": "Primitive",
      "description": "Creates a circle..."
    }
  ]
}
```

---

### 5. `get-canvas` — Get current canvas as parsed JSON (REQ/REP)

Returns the current Grasshopper document as a full XML snapshot (same data as `gh.event.xml` in subscribe), then parses it to structured JSON via `buildGhJson()`. This is the synchronous/on-demand equivalent of subscribing for `gh.event.xml`.

**Pattern:** REQ/REP on port **5557**

```sh
node dist/index.js get-canvas
```

**Response shape:**
```json
{
  "type": "getCurrentCanvas.response",
  "timestamp": 1700000000000,
  "docName": "Untitled",
  "xml": "<!-- full GH archive XML -->"
}
```

The client parses the XML field through the same `buildGhJson()` parser used by `subscribe`, outputting a `ParsedGrasshopper` JSON object with all components, wires, ports, values, and visuals.

**Comparison with `subscribe`:**

| | `get-canvas` (REQ/REP) | `subscribe` (PUB/SUB) |
|--|------------------------|----------------------|
| Delivery | One-shot, synchronous | Continuous stream |
| When | On demand | On every solution end |
| Output | Single parsed JSON | Stream of events + parsed XML |

---

## Communication Architecture

Three ZMQ channels connect the CLI client to the Rhino/Grasshopper plugin:

```
CLI (terminal-tui)                    Rhino/Grasshopper (rhino-zmq-poc)
    |                                      |
    |-- subscribe (SUB @ :5555) ---------->|  PUB  @ :5555   (gh.job.status, gh.event.xml)
    |                                      |
    |-- diff      (SUB @ :5555) ---------->|  (same PUB socket)
    |                                      |
    |-- submit    (PUSH @ :5556) --------->|  PULL @ :5556   -> JobQueue -> ExecuteCommand
    |<-- ack via SUB @ :5555 --------------|                   (status published back on PUB)
    |                                      |
    |-- list-components  (REQ @ :5557) --->|  REP  @ :5557   -> HandleRequest
    |<-- response -------------------------|
    |                                      |
    |-- get-canvas        (REQ @ :5557) ---|  (same REP socket)
    |<-- XML response ---------------------|
```

| Channel | Pattern | Direction | Port | Use Case |
|---------|---------|-----------|------|----------|
| Events | PUB/SUB | Server → Client | 5555 | Real-time events (subscribe, diff, acks) |
| Commands | PUSH/PULL | Client → Server | 5556 | Mutation commands (submit) |
| Queries | REQ/REP | Bidirectional sync | 5557 | Synchronous queries (list-components, get-canvas) |

## Environment Variables

| Variable        | Default           | Description                  |
|-----------------|-------------------|------------------------------|
| `GH_ZMQ_PUB`    | `localhost:5555`  | Pub/sub endpoint             |
| `GH_ZMQ_REQ`    | `localhost:5557`  | Request/reply endpoint       |
| `GH_TIMEOUT_MS` | `30000`           | Request timeout (ms)         |
| `GH_DEBUG`      | `0`               | Set to `1` for debug logging |

Example with custom endpoints:

```sh
GH_ZMQ_PUB=192.168.1.10:5555 GH_DEBUG=1 node dist/index.js subscribe
```
