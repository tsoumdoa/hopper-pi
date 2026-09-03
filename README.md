# hoppercode

A transparent, hackable modeling agent for computational designers who want
AI inside their real workflow — not locked behind a black-box SaaS.

> **Heads up:** This project was heavily vibe-coded and is super early in its own development. APIs, tools, and behavior will change without notice. **Use it at your own risk.**

**hoppercode** (published as [`hopper-pi`](https://www.npmjs.com/package/hopper-pi)) can run in two ways: as a normal Pi extension, or as a private Rhino-owned agent with a browser UI. Both use the same ZeroMQ backend to inspect and edit Grasshopper and Rhino.


## What's new

### Unreleased — Direct viewport capture

- **No screenshot permission prompt:** `rh_capture_view` can capture the Rhino viewport as soon as a multimodal model requests it. The per-session consent prompt and its environment override have been removed.

### 0.1.90 — Slim progressive tool catalog

- **Opt-in progressive tools:** start with a small always-on Hopper core and activate specialists on demand. Enable with `HOPPER_PROGRESSIVE_TOOLS=1` or `--hopper-progressive-tools`. Off by default, so the current all-tools-active behavior stays.
- **`hopper_search_tools`:** keyword search over the typed Hopper catalog; matching specialists activate for the rest of the session and reset on new/reload sessions.
- **Catalog + size diagnostics:** tools carry group, keywords, and core flags. `/hopper-schemas sizes` reports compact schema bytes by group and tool. Discoverable tools omit prompt snippets so the active set stays lean.

### 0.1.80 — Atomic graph apply & tool schema browser

- **`gh_apply_graph`:** create a complete new Grasshopper subgraph in one synchronous call — components, widgets, scripts, wires, and groups — then run one solution and return short IDs plus runtime/overlap validation. New builds default to one apply; legacy edit tools stay for surgical repair.
- **`/hopper-schemas`:** browse the exact agent-facing JSON schemas (name, description, parameters, guidelines) for every registered tool; `/hopper-schemas dump` writes `tool-schemas.json` in the cwd.
- **Anthropic schema fix:** `gh_apply_graph` wire endpoints now emit draft 2020-12 `prefixItems` tuples so Claude no longer rejects the tool `input_schema`.
- **Skill guidance:** modeling/cookbook/Rhino skills and reference docs point at the apply-once workflow; trim stale “core principles” from `gh-modeling-expert`.
- **Prompt examples:** add pavilion / attractor plan prompts under `prompt-examples/`.

### 0.1.70 — Faster agent guidance & screenshot override

- **Less overthinking in Grasshopper/Rhino skills:** tighten clarification rules so the agent proceeds with documented defaults unless ambiguity materially changes output, risks data loss, or could edit the wrong target.
- **Faster Grasshopper build guidance:** make “read once” a new-build default rather than a hard rule, remove verbose Tier 3 placement-math narration, allow confident multi-zone batching, and scope cleanup to touched components only.
- **Screenshot permission override:** `HOPPER_RHINO_CAPTURE_CONSENT=allow` pre-allows Rhino viewport screenshots for restricted or non-interactive UI sessions; `deny` forces capture off. Users can also explicitly ask to allow screenshots later in a session.
- **Tool schema cleanup:** `gh_list_components.searchFrom` now matches its documented default, and `gh_edit_components` uses action-specific required fields so agents can make shorter, more reliable tool calls.
- **Package cleanup:** remove stale Pi skill/prompt paths that pointed at missing directories.

### 0.1.6 — Undo history fix & security hardening

- **Fix: Rhino undo history (#16)** — nested agent undo records broke Rhino's undo stack. Per-script `RecordDocumentUndo` is now disabled during agent turns so the single `RhinoAgentTransaction` owns the undo record, and `Cancel` no longer calls `doc.Undo()` (which could wipe unrelated user edits).
- **Security hardening:** compare the ZMQ auth token in constant time, restrict the connection-profile token file to owner-only (`0600`), sanitize the view name interpolated into Rhino macros, and stop leaking stack traces to the wire.
- **Reliability:** dispose the `JobQueue` signal and stop fire-and-forget shutdown waits, widen `formatMetadata` to accept null, and tighten plugin visibility (`public` → `internal`).
- **CI/build:** add a GitHub Actions workflow for TypeScript typecheck and tests, bump to pnpm 11.5.3 / Node 22, disable credential persistence in checkout, and drop an unused `roslyn-language-server.linux-arm64` dependency.

### 0.1.5 — View capture & control

- **`rh_capture_view`** — capture a Rhino viewport screenshot as PNG visual context for visual QA, composition, visibility, and display checks. Permission-gated: only active after you allow Rhino viewport screenshots for the session, and only on models that accept image input.
- **`rh_view_control`** — drive the viewport: switch active / standard / named / CPlane views, set the camera (location, target, lens length, projection), zoom (extents / selected / bounding box), and save named views.
- New per-session viewport-capture consent flow so screenshots are opt-in.

### 0.1.4 — Agent can ask questions

- **`ask_user`** — ask the user a free-text clarifying question and wait for an answer when requirements are ambiguous.
- **`pick_option`** — present 2–6 informed options to pick from (e.g. resolving ambiguous component matches after `gh_list_components`). An "Other" choice is appended automatically.
- Fixes: silent failures on certain operations, long GUIDs leaking into output, and license corrections.

## What you need

- **Rhino 8** on Win or Mac
- **.NET 7 SDK** (to build the Grasshopper plugin on install)
- **Node.js** 22.19+ and pnpm 11.5.3 (for local development and packaging)
- **[Pi](https://github.com/earendil-works/pi)** only if you want the legacy extension workflow

## Quick start

### Private browser host

The Rhino package contains pinned Node 22.22.3 runtimes, exact Pi SDK dependencies, Hopper extensions, and the web UI. The macOS and Windows payloads each carry both x64 and arm64 Node executables, then select the native one when Rhino starts. It does not invoke or modify a globally installed Pi CLI.

```bash
git clone https://github.com/tsoumdoa/hoppercode.git
cd hoppercode
./scripts/install-rhino-mac.sh --open-rhino
```

The macOS script installs dependencies, builds and smoke-tests a fresh dual-architecture package, creates the Yak archive, and installs it from a local package source. If `hopper-pi` is already installed, it asks before replacing it. Quit Rhino before running the script.

For manual packaging on macOS or Windows:

```bash
HOPPER_SKIP_GH_PLUGIN=1 pnpm install
pnpm package:rhino -- --yak
```

Restart Rhino after installation, then run:

```text
_HopperCode
```

Rhino starts one private loopback host, waits for a validated ready message, and opens its tokenized localhost URL. Provider login, model choice, thinking level, conversations, extension dialogs, and tool progress stay in that browser tab. Run `_HopperCode` again to reopen the same live host, or `_HopperCodeStatus` to inspect it without starting anything.

Build the staging folder without a `.yak` by omitting `--yak`. This is useful for inspecting the exact package contents or when Yak is not available on the build machine. Rhino's current package layout requires the `.rhp` and `.gha` at the package top level; the staging script follows that layout.

### Existing Pi extension workflow

```bash
pi install npm:hopper-pi
```

`postinstall` builds the C# plugin and copies it into your Grasshopper `Libraries/hopper-pi/` folder.

1. Restart Rhino / Grasshopper.
2. On the canvas, add the **Hopper Code Backend** component (`GHZMQ`, under Params → Util).
3. Start Pi and talk to the agent about Grasshopper or Rhino. The extension registers `gh_*` and `rh_*` tools automatically.

The GHZMQ component remains compatible with old definitions. In the browser-host workflow, `_HopperCode` owns the backend lifecycle and no component is required.

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
Browser UI  ⇄  private Hopper host + embedded Pi SDK  ⇄  RPC v2  ⇄  Rhino-owned host
                         ↑                                  ↑
                  exact local package                 active GH document
```

- `Hopper.Rhino.rhp` owns `_HopperCode`, transport, dispatch, Rhino operations, the host process, health checks, and shutdown.
- `Hopper.Grasshopper.gha` registers Grasshopper operations lazily and owns active-canvas subscriptions.
- The legacy GHZMQ component remains a passive compatibility marker for existing definitions; it does not start transport or Node.
- The host binds only `127.0.0.1`, checks the browser origin, and requires a 256-bit token as the first WebSocket message. The token begins in the URL fragment and is removed from browser history.
- Provider credentials use the global Pi auth file at `~/.pi/agent/auth.json` by default, including `PI_CODING_AGENT_DIR` overrides. Login, token refresh, and logout in Hopper update that shared file. Model settings remain in Hopper's private user-data directory. Session and workspace state are separated per live Rhino backend instance.

The command and query sockets require the connection-profile token. The PUB/SUB event socket is loopback-only but intentionally unauthenticated for legacy clients, so other processes running as the same local user can subscribe to canvas snapshots. Treat the workstation account as the confidentiality boundary and do not expose the ZMQ ports beyond loopback.

| Port | Pattern | Purpose |
| ---- | ------- | ------- |
| `5555` | PUB/SUB | Events: job status, canvas XML snapshots |
| `5556` | PUSH/PULL | Commands: edits, scripts, widgets |
| `5557` | REQ/REP | Queries plus synchronous atomic graph application |

The backend tries the legacy `5555`-`5557` ports first. If any are already in use, it automatically binds a free loopback port triplet and writes the live endpoints plus a local connection token to a user-local connection profile:

- Windows: `%APPDATA%\hopper-pi\connection.json`
- macOS: `~/Library/Application Support/hopper-pi/connection.json`
- Linux: `~/.local/share/hopper-pi/connection.json` (or `$XDG_DATA_HOME/hopper-pi/connection.json`)

Each backend also writes an instance-specific profile under `hopper-pi/instances/`. The Rhino-owned host receives that exact path, so two Rhino processes do not fight over the compatibility pointer. The token is generated once and reused across backend/frontend restarts. Override discovery with `HOPPER_CONNECTION_PROFILE`, or override endpoints manually with `GH_ZMQ_PUB`, `GH_ZMQ_PUSH`, and `GH_ZMQ_REQ`. If you manually point at a token-protected backend, set `GH_ZMQ_TOKEN` as well.

## Agent tools (overview)

**Rhino document**

| Tool | Role |
| ---- | ---- |
| `rh_run_script` | Rhino commands, Python, or C# on the active document |
| `rh_query_objects` | List/count objects (short IDs for GH params) |
| `rh_view_control` | Viewport, projection, camera, CPlane view, and zoom |
| `rh_capture_view` | Optional viewport screenshot for multimodal models |

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

**User clarification**

| Tool | Role |
| ---- | ---- |
| `pick_option` | Ask the user to choose among informed options |
| `ask_user` | Ask a free-text question when options are not practical |

**Progressive loading (opt-in)**

| Tool | Role |
| ---- | ---- |
| `hopper_search_tools` | Search the Hopper catalog and activate specialists (`HOPPER_PROGRESSIVE_TOOLS=1` / `--hopper-progressive-tools`) |

Bundled Pi skills and progressive reference docs live under `mds/` (`gh-modeling-expert`, `rhino-document`, `gh-cookbook`, and `gh-reference`).

For new Grasshopper builds, the canonical workflow is: resolve unusual or ambiguous types if needed, call `gh_apply_graph` once, inspect its integrated runtime/overlap validation, then use legacy tools only for surgical repair. `gh_get_canvas` remains for existing canvases, selections, and subgraphs.

## Repo layout

| Path | Role |
| ---- | ---- |
| `src/host/` | Embedded Pi runtime, loopback server, protocol, and browser UI |
| `src/` | Pi extension, ZMQ client, tools, and XML parsing |
| `grasshopper-plugin/Hopper.Rhino/` | Rhino lifecycle plug-in and `_HopperCode` command |
| `dotnet/Hopper.Grasshopper/` | Lazy Grasshopper operation adapter and passive GHZMQ compatibility component |
| `dotnet/Hopper.Core/` | Rhino/Grasshopper-free protocol, lifecycle, dispatch, and transport policies |
| `scripts/package-rhino.mjs` | Stage a platform package with official Node and production dependencies |
| `docs/hopper-local-architecture.html` | Interactive architecture and implementation plan |
| `mds/` | Skills and progressive reference docs for the agent |

## Environment variables

| Variable | Effect |
| -------- | ------ |
| `HOPPER_SKIP_GH_PLUGIN=1` | Skip plugin build/install on `pnpm install` |
| `HOPPER_GH_LIBRARIES` | Override Grasshopper Libraries install path |
| `HOPPER_GH_PLUGIN_DIR` | Subfolder under Libraries (default: `hopper-pi`) |
| `HOPPER_GH_STRICT=1` | Fail install on build/copy errors (default: warn and continue) |
| `GH_ZMQ_PUB` / `GH_ZMQ_PUSH` / `GH_ZMQ_REQ` | ZMQ endpoint overrides |
| `GH_ZMQ_TOKEN` | Connection token override when manually setting endpoints |
| `HOPPER_CONNECTION_PROFILE` | Connection profile path override |
| `HOPPER_PI_AUTH_PATH` | Override the auth file; defaults to the global Pi `auth.json` |
| `HOPPER_PROGRESSIVE_TOOLS=1` | Opt in to a small Hopper core + `hopper_search_tools` (specialists activate on demand). Off by default. Also `--hopper-progressive-tools`. |
| `HOPPER_YAK` | Absolute path to Yak when `package:rhino -- --yak` cannot find Rhino 8 automatically |
| `HOPPER_NODE_EXECUTABLE` / `HOPPER_HOST_ENTRY` | Absolute developer-only launch overrides; the packaged plug-in never searches `PATH` |

## Troubleshooting

- **Inspect tool schemas:** Run `/hopper-schemas` to browse the JSON schemas exposed to the agent for every registered tool (or `/hopper-schemas rh_run_script` / `/hopper-schemas all`). Dump them with `/hopper-schemas dump` (writes `tool-schemas.json` in the cwd). `/hopper-schemas sizes` reports catalog counts and compact schema bytes by group/tool.
- **`_HopperCode` is unknown:** Install the generated `.yak`, rather than copying only the `.gha` to Grasshopper Libraries, then restart Rhino. A Rhino `.rhp` must be loaded for the command to exist.
- **Browser host does not open:** Run `_HopperCodeStatus`. It reports backend state, child PID, health, and startup errors without printing the secret URL.
- **No backend / tools fail in legacy Pi mode:** Ensure **Hopper Code Backend** is on the canvas and Rhino is running, then run `/hopper-backend` to refresh the connection. If ports 5555–5557 are busy, the backend falls back to free loopback ports and shows the profile path in the component log.
- **Invalid connection token:** Restart the frontend after the backend has started so it can reread the connection profile. If you are using manual endpoint env vars, also set `GH_ZMQ_TOKEN`.
- **GH shows offline when Revit has focus (Rhino Inside):** The plugin marshals Grasshopper work onto Rhino's UI thread via `InvokeOnUiThread` (not `Idle`). Keep Grasshopper visible while the agent is working, or run `/hopper-backend` after refocusing. Liveness checks use a lightweight `ping` probe that does not touch the canvas. Older Rhino.Inside.Revit versions may still limit background Grasshopper — RiR 1.27+ improves this.
- **Plugin did not install:** Install [.NET 7 SDK](https://dotnet.microsoft.com/download), then run `pnpm run build:gh-plugin`. On Windows, set `HOPPER_GH_LIBRARIES` if auto-detect fails.
- **Stale plugin after `git pull`:** `node scripts/install-grasshopper-plugin.mjs --force`, then restart Rhino.

## License

MIT — see [LICENSE](LICENSE).
