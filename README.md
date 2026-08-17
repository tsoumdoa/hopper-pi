# hoppercode

A transparent, hackable modeling agent for computational designers who want
AI inside their real workflow — not locked behind a black-box SaaS.

> **Heads up:** This project was heavily vibe-coded and is super early in its own development. APIs, tools, and behavior will change without notice. **Use it at your own risk.**

**hoppercode** (npm package still named [`hopper-pi`](https://www.npmjs.com/package/hopper-pi) until registry ownership is confirmed) is a standalone `hopper` CLI plus a Grasshopper plugin. Any shell-capable agent can inspect and edit a Grasshopper canvas—and run scripts against the Rhino document—over ZeroMQ while Rhino is open.

This branch is an **exploratory CLI port**. It is not a commitment to replace the current mainline release.

## What's new

Version 0.1.90 adds the standalone `hopper` CLI, durable sessions and history,
the versioned request protocol, and atomic `gh_apply_graph` execution. Run
`hopper catalog --json` and `hopper schema <operation> --json` to inspect the
available operations.

## What you need

- **Rhino 8** on Win or Mac
- **.NET 7 SDK** (to build the Grasshopper plugin)
- **Node.js** 20+ (for the `hopper` CLI)

## Quick start

### Install the CLI

```bash
npm install -g hopper-pi
```

The package's `postinstall` hook builds the C# plugin and copies the `.gha` and
supporting `.dll` files into Grasshopper's `Libraries/hoppercode/` directory.
Set `HOPPER_SKIP_GH_PLUGIN=1` to skip it, or run `hopper plugin install --json`
later if automatic path detection is unavailable.

1. Restart Rhino / Grasshopper.
2. On the canvas, add the **Hopper Code Backend** component (`GHZMQ`, under Params → Util).
3. From any agent that can run shell commands:

```bash
hopper status --json
hopper session start --name "pavilion" --json
hopper catalog --json
hopper call gh_get_canvas --data '{}' --json
```

Mutations require `--session` (or `HOPPER_SESSION_ID`). Viewport captures also need `--allow-capture`.

### Clone and develop

```bash
git clone https://github.com/tsoumdoa/hoppercode.git
cd hoppercode
pnpm install
pnpm test
pnpm exec hopper --help
```

`pnpm install` also runs the plugin installer unless `HOPPER_SKIP_GH_PLUGIN=1`
is set.

Skip the plugin build when iterating on TypeScript only:

```bash
export HOPPER_SKIP_GH_PLUGIN=1
pnpm install
pnpm run dev
```

Build or reinstall the plugin manually:

```bash
pnpm run build:gh-plugin
# Build and install through the guarded plugin manager:
pnpm exec hopper plugin install --force
```

## Architecture

```
agent  →  hopper CLI  →  ZMQ  →  Hopper Code Backend (Grasshopper in Rhino)
```

| Port | Pattern | Purpose |
| ---- | ------- | ------- |
| `5555` | PUB/SUB | Events: job status, canvas XML snapshots |
| `5556` | PUSH/PULL | Deprecated leftover transport from the Pi-era plugin |
| `5557` | REQ/REP (router) | Versioned CLI protocol: status, queries, mutations, checkpoints |

The backend tries the legacy `5555`-`5557` ports first. If any are already in use, it automatically binds a free loopback port triplet and writes the live endpoints plus a local connection token to a user-local connection profile:

- Windows: `%APPDATA%\hoppercode\connection.json`
- macOS: `~/Library/Application Support/hoppercode/connection.json`
- Linux: `~/.local/share/hoppercode/connection.json` (or `$XDG_DATA_HOME/hoppercode/connection.json`)

If a `hopper-pi` profile exists and the `hoppercode` profile does not, Hopper copies the old profile and token into the new directory. It never prints the token.

The token is generated once and reused across backend/frontend restarts, so normal restarts do not require re-pairing. Override discovery with `HOPPER_CONNECTION_PROFILE`, or override endpoints manually with `GH_ZMQ_PUB`, `GH_ZMQ_PUSH`, and `GH_ZMQ_REQ`. If you manually point at a token-protected backend, set `GH_ZMQ_TOKEN` as well.

## CLI operations (overview)

**Rhino document**

| Tool | Role |
| ---- | ---- |
| `rh_run_script` | Rhino commands, Python, or C# on the active document |
| `rh_query_objects` | List/count objects (short IDs for GH params) |
| `rh_view_control` | Viewport, projection, camera, CPlane view, and zoom |
| `rh_capture_view` | Optional consent-gated viewport screenshot for multimodal models |

**Grasshopper canvas — edit**

| Tool | Role |
| ---- | ---- |
| `gh_apply_graph` | Atomically create and validate a complete new subgraph |
| `gh_edit_components` | Surgical add, move, or delete operations |
| `gh_edit_param` | Inspect and edit GH script-component input/output ports |
| `gh_edit_wire` | Connect / disconnect wires |
| `gh_edit_group` | Groups |
| `gh_edit_script` | Script component source |
| `gh_create_widget` / `gh_mutate_widget` | Surgical widget creation or changes |
| `gh_param_rhino` | Reference or internalize Rhino geometry on params |

**Grasshopper canvas — query**

| Tool | Role |
| ---- | ---- |
| `gh_get_canvas` | Canvas layout and component snapshot |
| `gh_list_components` | Search component library by keyword |
| `gh_get_canvas_errors` | Runtime messages plus component-overlap checks |

The calling agent owns conversation, clarification, and model choice.

Bundled modeling notes still live under `mds/` (`gh-modeling-expert`, `rhino-document`, `gh-cookbook`, and `gh-reference`).

For new Grasshopper builds, the canonical workflow is: resolve unusual or ambiguous types if needed, call `gh_apply_graph` once, inspect its integrated runtime/overlap validation, then use legacy tools only for surgical repair. `gh_get_canvas` remains for existing canvases, selections, and subgraphs.

## Repo layout

| Path | Role |
| ---- | ---- |
| `src/` | `hopper` CLI, operation registry, sessions, protocol client |
| `grasshopper-plugin/` | C# Grasshopper plugin (`rhino-zmq-poc.gha`) |
| `scripts/install-grasshopper-plugin.mjs` | Postinstall entry point and build-only helper |
| `mds/` | Modeling skills and reference docs for the agent |

## Environment variables

| Variable | Effect |
| -------- | ------ |
| `HOPPER_SKIP_GH_PLUGIN=1` | Skip plugin build/install on `pnpm install` |
| `HOPPER_GH_LIBRARIES` | Override Grasshopper Libraries install path |
| `HOPPER_GH_PLUGIN_DIR` | Subfolder under Libraries (default: `hoppercode`) |
| `HOPPER_GH_STRICT=1` | Fail install on build/copy errors (default: warn and continue) |
| `GH_ZMQ_PUB` / `GH_ZMQ_PUSH` / `GH_ZMQ_REQ` | ZMQ endpoint overrides |
| `GH_ZMQ_TOKEN` | Connection token override when manually setting endpoints |
| `HOPPER_CONNECTION_PROFILE` | Connection profile path override |
| `HOPPER_SESSION_ID` | Default session for `hopper call` / `hopper batch` |

## Troubleshooting

- **Inspect operation schemas:** `hopper catalog --json` and `hopper schema <operation> --json`.
- **No backend / commands fail:** Ensure **Hopper Code Backend** is on the canvas and Rhino is running, then run `hopper status --json`. If ports 5555–5557 are busy, the backend should fall back to free loopback ports automatically and show the profile path in the component log.
- **Invalid connection token:** Restart the frontend after the backend has started so it can reread the connection profile. If you are using manual endpoint env vars, also set `GH_ZMQ_TOKEN`.
- **GH shows offline when Revit has focus (Rhino Inside):** The plugin marshals Grasshopper work onto Rhino's UI thread via `InvokeOnUiThread` (not `Idle`). Keep Grasshopper visible while the agent is working, then rerun `hopper status --json`. Older Rhino.Inside.Revit versions may still limit background Grasshopper — RiR 1.27+ improves this.
- **Plugin did not install:** Install [.NET 7 SDK](https://dotnet.microsoft.com/download), then run `pnpm exec hopper plugin install`. On Windows, set `HOPPER_GH_LIBRARIES` to the Grasshopper `Libraries` folder if auto-detect fails.
- **Stale plugin after `git pull`:** Run `pnpm exec hopper plugin install --force`, then restart Rhino.

## License

MIT — see [LICENSE](LICENSE).
