# hoppercode

CLI tool for interacting with Grasshopper via ZMQ. Requires the GH ZMQ Plugin component running inside Rhino/Grasshopper.

## Setup

```sh
cd terminal-tui
npm install
npm run build
```

## Usage

### Subscribe to events

Listen to all events from Grasshopper:

```sh
node dist/index.js subscribe
```

Filter by topic prefix:

```sh
node dist/index.js subscribe --filter gh.job
```

Save received XML snapshots to files:

```sh
node dist/index.js subscribe --save-xml
```

### Submit commands

One-shot command via flags:

```sh
node dist/index.js submit addComponent --componentType Circle --nickName "My Circle" --x 100 --y 200
node dist/index.js submit deleteComponent --targetId "Area_1"
node dist/index.js submit renameComponent --targetId "Panel_1" --nickName "New Name"
node dist/index.js submit moveComponent --targetId "Circle_1" --x 300 --y 400
node dist/index.js submit connectWire --fromComponent "Panel_1" --fromPort "output" --toComponent "Circle_1" --toPort "radius"
node dist/index.js submit disconnectWire --fromComponent "Panel_1" --fromPort "output" --toComponent "Circle_1" --toPort "radius"
node dist/index.js submit setComponentLocked --targetId "Circle_1" --locked true
node dist/index.js submit setComponentHidden --targetId "Circle_1" --hidden false
node dist/index.js submit addGroup --componentIds "Circle_1,Panel_1" --groupName "My Group"
node dist/index.js submit removeFromGroup --componentIds "Circle_1" --groupName "My Group"
node dist/index.js submit setSliderValue --targetId "Slider_1" --value 42.5
node dist/index.js submit setPanelText --targetId "Panel_1" --text "hello world"
```

Interactive mode (numbered menu):

```sh
node dist/index.js submit
node dist/index.js submit --interactive
```

### Diff document snapshots

Compare GH document changes between solution ends. On first run it saves a baseline; on subsequent runs it diffs against the previous snapshot:

```sh
node dist/index.js diff
```

Continuous watch mode (diff every new snapshot):

```sh
node dist/index.js diff --watch
```

Output shows added/removed/changed components, property-level changes (e.g. slider values, nicknames, ports, wires), and wire additions/removals. The baseline is stored at `~/.gh-diff-baseline.xml`. To reset, delete that file.

### Available actions

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

## Environment Variables

| Variable        | Default              | Description                  |
|-----------------|----------------------|------------------------------|
| `GH_ZMQ_PUB`    | `localhost:5555`     | Pub/sub endpoint             |
| `GH_ZMQ_REQ`    | `localhost:5556`     | Request/reply endpoint       |
| `GH_TIMEOUT_MS` | `30000`              | Request timeout (ms)         |
| `GH_DEBUG`      | `0`                  | Set to `1` for debug logging |

Example with custom endpoints:

```sh
GH_ZMQ_PUB=192.168.1.10:5555 GH_DEBUG=1 node dist/index.js subscribe
```

## Architecture

```
CLI (terminal-tui)                    Rhino/Grasshopper
    |                                      |
    |-- subscribe (SUB @ 5555) ----------->|  PUB @ 5555 (gh.job.status, gh.event.xml)
    |                                      |
    |-- diff (SUB @ 5555) ---------------->|  Receives XML snapshots, parses and diffs
    |                                      |
    |-- submit (REQ @ 5556) ------------->|  ROUTER @ 5556 -> JobQueue -> ExecuteCommand
    |<-- response ------------------------|
```
