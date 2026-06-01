# hoppercode

A transparent, hackable modeling agent for computational designers who want
AI inside their real workflow — not locked behind a black-box SaaS.

> **Heads up:** This project was heavily vibe-coded and is super early in its own development. APIs, tools, and behavior will change without notice. **Use it at your own risk.**

**hoppercode** (published as [`hopper-pi`](https://www.npmjs.com/package/hopper-pi)) is a [Pi](https://github.com/earendil-works/pi) extension plus a Grasshopper plugin that lets an AI agent inspect and edit a Grasshopper canvas—and run scripts against the Rhino document—over ZeroMQ while Rhino is open.


## What you need

- **Rhino 8** on Win or Mac
- **[Pi](https://github.com/earendil-works/pi)** (the coding agent)
- **.NET 7 SDK** (to build the Grasshopper plugin on install)
- **Node.js** 20+ (for local development)

## Quick start

### Install via Pi

```bash
pi install npm:hopper-pi
```

`postinstall` builds the C# plugin and copies it into your Grasshopper `Libraries/hopper-pi/` folder.

1. Restart Rhino / Grasshopper.
2. On the canvas, add the **Hopper Code Backend** component (`GHZMQ`, under Params → Util).
3. Start Pi and talk to the agent about Grasshopper or Rhino—the extension registers `gh_*` and `rh_*` tools automatically.

### Clone and develop

```bash
git clone https://github.com/tsoumdoa/hoppercode.git
cd hoppercode
pnpm install          # builds & installs the GH plugin unless skipped
pnpm run pi           # run Pi with this extension loaded
```

Skip the plugin build when iterating on TypeScript only:

```bash
export HOPPER_SKIP_GH_PLUGIN=1
pnpm install
pnpm run dev
```

Rebuild or reinstall the plugin manually:

```bash
pnpm run build:gh-plugin
# or force a full rebuild + copy:
node scripts/install-grasshopper-plugin.mjs --force
```

## Architecture

```
Pi agent  →  hopper-pi (Node/TS)  →  ZMQ :5555–5557  →  Hopper Code Backend (Grasshopper in Rhino)
```

| Port | Pattern | Purpose |
| ---- | ------- | ------- |
| `5555` | PUB/SUB | Events: job status, canvas XML snapshots |
| `5556` | PUSH/PULL | Commands: edits, scripts, widgets |
| `5557` | REQ/REP | Queries: canvas state, component search, errors |

Override endpoints with `GH_ZMQ_PUB`, `GH_ZMQ_PUSH`, and `GH_ZMQ_REQ` (see `src/infra/connection.ts`).

## Agent tools (overview)

**Rhino document**

| Tool | Role |
| ---- | ---- |
| `rh_run_script` | Rhino commands, Python, or C# on the active document |
| `rh_query_objects` | List objects (short IDs for GH params) |

**Grasshopper canvas — edit**

| Tool | Role |
| ---- | ---- |
| `gh_edit_components` | Add, move, delete components |
| `gh_edit_param` | Parameter values and expressions |
| `gh_edit_wire` | Connect / disconnect wires |
| `gh_edit_group` | Groups |
| `gh_edit_script` | Script component source |
| `gh_create_widget` / `gh_mutate_widget` | Sliders, panels, toggles, etc. |
| `gh_param_rhino` | Reference or internalize Rhino geometry on params |

**Grasshopper canvas — query**

| Tool | Role |
| ---- | ---- |
| `gh_get_canvas` | Canvas layout and component snapshot |
| `gh_list_components` | Search component library by keyword |
| `gh_get_canvas_errors` | Runtime errors on the canvas |

Bundled Pi **skills** and **prompts** live under `mds/` (e.g. `gh-modeling-expert`, `rhino-document`, `gh-cookbook`).

## Repo layout

| Path | Role |
| ---- | ---- |
| `src/` | Pi extension: ZMQ client, tools, XML parsing |
| `grasshopper-plugin/` | C# Grasshopper plugin (`rhino-zmq-poc.gha`) |
| `scripts/install-grasshopper-plugin.mjs` | Build + install plugin to Libraries |
| `mds/` | Skills, prompts, and reference docs for the agent |

## Environment variables

| Variable | Effect |
| -------- | ------ |
| `HOPPER_SKIP_GH_PLUGIN=1` | Skip plugin build/install on `pnpm install` |
| `HOPPER_GH_LIBRARIES` | Override Grasshopper Libraries install path |
| `HOPPER_GH_PLUGIN_DIR` | Subfolder under Libraries (default: `hopper-pi`) |
| `HOPPER_GH_STRICT=1` | Fail install on build/copy errors (default: warn and continue) |
| `GH_ZMQ_PUB` / `GH_ZMQ_PUSH` / `GH_ZMQ_REQ` | ZMQ endpoint overrides |

## Troubleshooting

- **No backend / tools fail:** Ensure **Hopper Code Backend** is on the canvas and Rhino is running. Check that nothing else is bound to ports 5555–5557.
- **Plugin did not install:** Install [.NET 7 SDK](https://dotnet.microsoft.com/download), then run `pnpm run build:gh-plugin`. On Windows, set `HOPPER_GH_LIBRARIES` if auto-detect fails.
- **Stale plugin after `git pull`:** `node scripts/install-grasshopper-plugin.mjs --force`, then restart Rhino.

## License

MIT — see [LICENSE](LICENSE).
