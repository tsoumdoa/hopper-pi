# hoppercode

A transparent, hackable modeling agent for computational designers who want
AI inside their real workflow — not locked behind a black-box SaaS.

> **Heads up:** This project was heavily vibe-coded and is super early in its own development. APIs, tools, and behavior will change without notice. **Use it at your own risk.**

**hoppercode** (published as [`hopper-pi`](https://www.npmjs.com/package/hopper-pi)) runs through a persistent local host with a browser UI. Its embedded Pi agent uses an authenticated ZeroMQ backend to inspect and edit Grasshopper and Rhino.


## What's new

### Unreleased image attachments

The browser composer accepts PNG, JPEG, WebP, and GIF files through the image button, drag and drop, or clipboard paste. Attach up to four images, each at most 5 MB. Use the thumbnail controls to replace or remove an attachment before sending.

Click an image to annotate it with Excalidraw. Add arrows, shapes, text, or freehand marks, then choose **Save annotations**. You can reopen and edit the marks while the image is in your draft. Sending exports the drawing as a PNG for the selected vision model; the conversation retains that image after reconnecting. Draft images and editable drawing data are kept in memory and are cleared by a page reload or a new session.

To sketch without an image, click the pen icon in the composer. This opens a blank Excalidraw canvas with the freehand tool selected. Choose **Save drawing** to attach it as a PNG; click its thumbnail to continue editing before sending. Drawings share the four-attachment limit with uploaded images.

Use **Image opacity** below the editor to fade the source image from 100% to 0% while keeping your annotations visible. The setting is included in the saved PNG and restored when you reopen the draft's annotations.

Oversized annotation exports are reduced in resolution to fit the 5 MB attachment limit. The editable drawing retains its original scene data. Draft text, images, and annotations stay in the composer until the host accepts the message; rejected or interrupted submissions remain available to retry.

The editor loads on demand. Its fonts are included in the web build and served by the local host. Excalidraw adds about 13 MB of font assets plus its JavaScript bundles to the packaged UI.

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

- **Rhino 8** on macOS arm64 or Windows x64
- A stable **Node.js 22.19.0 or newer** installation
- **.NET 7 SDK** and pnpm 11.5.3 only when building Hopper from source
- **[Pi](https://github.com/earendil-works/pi)** only for the external extension workflow

## Quick start

### Rhino browser host

Hopper's Yak packages contain the Rhino plug-ins, private browser host, Pi SDK dependencies, and web UI. They do not contain Node. Install a stable Node release at or above 22.19.0 and check it before installing Hopper:

```text
node --version
```

Prerelease Node versions are not supported. Hopper runs Node directly and never invokes a global Pi CLI.

#### macOS arm64

```bash
git clone https://github.com/tsoumdoa/hoppercode.git
cd hoppercode
./scripts/install-rhino-mac.sh --open-rhino
```

Quit Rhino before running the script. It builds and verifies the `mac-arm64` package, creates the Yak archive, stops Hopper's background host, and installs it with Rhino 8's Yak executable. If `hopper-pi` is installed, the script asks before replacing it. The next `HopperCode` command starts the newly installed host; saved history remains available.

#### Windows x64

Run these commands in PowerShell with Rhino closed:

```powershell
git clone https://github.com/tsoumdoa/hoppercode.git
cd hoppercode
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-rhino-win.ps1 -OpenRhino
```

The command installs dependencies, builds and verifies a fresh `win-x64` Yak package, smoke-tests the packaged host (including native ZeroMQ, SQLite, and esbuild), stops the previous Hopper host, and installs through Rhino 8's Yak. Use `-Yes` to replace an existing Hopper package without prompting. Set `HOPPER_YAK` to the absolute Yak executable path if Rhino is installed elsewhere.

To build and test without installing, replace `-OpenRhino` with `-BuildOnly`. After dependencies are installed, the shorthand is `pnpm install:rhino:win -OpenRhino` (or `-BuildOnly`). Use the direct PowerShell command for the first run: pnpm can auto-install dependencies before running scripts, triggering the legacy Grasshopper postinstall. The PowerShell installer suppresses that legacy install. If pnpm's PowerShell shim is blocked by execution policy, use `pnpm.cmd` instead.

For a Windows acceptance check, run `HopperCode` in an empty Rhino document and confirm the browser UI opens. Connect a second Rhino instance with `HopperCode`, confirm both appear in the picker, and ask Hopper to create one box in each document. Check that each box lands in the intended document, reload the browser to check conversation restoration, then close all Rhino instances and confirm the shared host exits. Use disposable documents for this check.

If you previously used the legacy Grasshopper installer, move `%APPDATA%\Grasshopper\Libraries\hopper-pi` to a backup location outside Grasshopper's Libraries before launching Rhino with the Yak package, to avoid loading duplicate Hopper plugins.

To build a target without creating a `.yak`, omit `--yak`:

```bash
HOPPER_SKIP_GH_PLUGIN=1 pnpm install
pnpm package:rhino -- --target mac-arm64
```

Restart Rhino after installation, then run:

```text
HopperCode
```

Rhino attaches to one private loopback host for your OS user, starting it if needed, and opens the authenticated browser UI. This is the default behavior when you launch Rhino normally. Provider login, model choice, conversations, and work in progress stay in that browser tab.

When no Rhino document is connected, the composer remains available for discussion. To work on documents, open Rhino and run `HopperCode`. The agent can create or open files in accessible connected processes through the ordinary document tools. On Windows, it can use `launchRhino` to start an additional instance from a connected Rhino installation, connect it automatically, and delegate to its ready document. On Mac, additional documents use `rh_document` with action `new` in the same process.

The sidebar lists connected **Hopper Code instances**, not every running Rhino process. Run `HopperCode` in each Rhino document you want in the picker. On Mac, those documents share one process connection. A document created manually with Rhino `New` stays out of the picker until you run `HopperCode` there. Documents created or opened through Hopper are initialized automatically.

Messages can read and edit all initialized documents in connected Hopper Code instances by default. The main task owns the document selected in the picker and edits it directly. The shared Node host can send child tasks to other accessible documents and return their results to the main task. Independent child agents run concurrently, including within one Mac Rhino process. Each native tool call acquires the process, activates its captured document, and finishes its transaction before releasing Rhino. Thinking and skill reading do not reserve the process. Each editing tool call has its own undo segment. Click **All instances** beside the message picker to switch to **This instance**, which restricts the next message to the chosen document's Rhino process. Access is captured when you send; changing the picker or access setting does not redirect work already in progress. The chat input starts at three lines and grows as you type.

The compact document picker beside the composer shows where your next message will go. Open it to select an available Rhino document or Grasshopper canvas. Closed instances and internal document IDs stay out of the picker. Existing work keeps its selected documents; a closed selection shows an unavailable notice instead of silently switching targets. On Mac, create additional document windows with Rhino `New` inside the same Rhino process. Agents in that process can think concurrently; only their native tool calls take turns. Native calls in separate Rhino processes can also run concurrently.

The host remains running when you close Rhino. Closing a document or stopping its plugin removes that target without switching its tasks to another document. Use the browser's **Stop host** action to stop the background host; run `HopperCode` explicitly to start it again.

Reloading the browser or opening `HopperCode` in another document or Rhino instance keeps the current conversation while at least one connected Rhino process remains running. After you quit all connected Rhino processes, the next `HopperCode` launch starts a fresh chat. Older conversations remain stored. If you close only the browser tab, run `HopperCode` again to reopen the current thread. Closing the tab leaves the host and any active response running. The reopened UI restores the conversation and current progress. If another Hopper tab is still open, the new tab takes over the connection.

Open **Skills & Markdown** in the sidebar to inspect the bundled skills, preview their Markdown and reference files, or turn individual skills off. Enabled skills appear in the agent's skill catalog; the agent can load relevant files with a restricted `read` tool. This tool only reads enabled Markdown in this library. Pi's general shell, edit, and write tools remain disabled.

To add your own instructions:

1. Copy the **Your Markdown folder** path from the panel and open it in Finder or File Explorer.
2. Save or drop `.md` files there. Plain Markdown works; the filename becomes the skill name and the first non-empty line becomes its description.
3. The panel refreshes every three seconds while Hopper is idle. The host also scans before a new prompt, so the panel does not need to stay open.

For instructions with references, create a folder containing `SKILL.md` and related Markdown files. Optional YAML frontmatter sets the name and description:

```markdown
---
name: office-modeling
description: Office standards for architectural models, units, and layer names.
---

# Office modeling standards
Use meters. Follow the layer names in [layers.md](./layers.md).
```

Markdown under a `SKILL.md` folder belongs to that skill and is disabled with it. Other Markdown files, including those in subfolders, are listed individually. Symbolic links and non-Markdown files are skipped. Each file is limited to 256 KiB, with up to 500 Markdown files in the library. Discovery errors appear in the panel.

The default drop folder is `<pinned shared data directory>/skills`. On macOS this is `~/Library/Application Support/hopper-pi/host/shared-host/skills`; on Windows it is `%APPDATA%/hopper-pi/host/shared-host/skills`. To use an existing folder elsewhere, enter its absolute path in the panel and choose **Use folder**. Paths beginning with `~/` also work. Keep this folder separate from the bundled skill directories.

The host saves the folder and disabled skill IDs in `<pinned shared data directory>/skills-settings.json`, shared by Hopper windows using that data directory. If multiple windows save settings simultaneously, the last save wins. Changes apply at the next idle refresh or prompt, and controls are disabled while a turn is running. Disabling a skill removes it from discovery and prevents further reads through `read`; it does not remove text already in conversation history. Start a new session for a clean context. The read restriction applies to this file-reading tool, not to scripts executed inside Rhino.

Skill choices survive restarts. Skills are enabled unless their ID appears in the saved `disabled` list; turning one back on removes its ID. The model picker saves the selected provider and model as `defaultProvider` and `defaultModel` in `<host data directory>/agent/settings.json`. New sessions use that selection when its provider is authenticated and the model is available. Resuming an existing conversation restores that conversation's model first.

On Windows, press **Win+R**, enter `%APPDATA%\hopper-pi\host`, and press Enter. This normally opens `C:\Users\<username>\AppData\Roaming\hopper-pi\host`:

| Relative path | Saved content |
| --- | --- |
| `shared-host\skills\` | Custom Markdown files, unless you chose another folder |
| `shared-host\skills-settings.json` | Custom folder path and disabled skill IDs |
| `agent\settings.json` | Last selected provider/model and Pi preferences |

On macOS, these files are under `~/Library/Application Support/hopper-pi/host`. A host launched with `--data-dir` stores its journal and skills under that directory's `shared-host` subdirectory. Once initialized, control state pins that location. Changing the custom Markdown folder does not move the settings files.

The Rhino commands are:

| Command | Behavior |
| ------- | -------- |
| `HopperCode` | Start Hopper from `stopped` or `faulted`. When `running`, reopen the browser with the current conversation. In other states, print the current state. |
| `HopperCodeStatus` | Print lifecycle, Node, transport, document, Grasshopper, dispatcher, and recent error details without starting Hopper. |
| `HopperCodeStop` | Detach this Rhino lifecycle and stop its transport. Leave the shared host and other attached Rhino lifecycles running. |
| `HopperCodeRestart` | Detach and reattach this Rhino lifecycle. Repeated restart requests are coalesced. The shared host keeps running. |

`HopperCode` does not load Grasshopper. The first `gh_*` tool call starts it once and waits up to 60 seconds for readiness. Rhino may open the Grasshopper editor and create an untitled definition during that explicit tool call. Grasshopper tools require an active definition, while `rh_*` tools continue to work without one.

### Choosing Node

Hopper resolves Node in this order:

1. The absolute path in `HOPPER_NODE_EXECUTABLE`.
2. `nodeExecutable` in Hopper's app-data `config.json`.
3. `node` from the Rhino process `PATH`.
4. Standard installation paths.

The standard macOS paths are `/opt/homebrew/bin/node`, `/usr/local/bin/node`, and `/usr/bin/node`. On Windows, Hopper checks `%ProgramFiles%\nodejs\node.exe` and `%LocalAppData%\Programs\nodejs\node.exe`.

Rhino launched from Finder or the Windows desktop may have a different `PATH` than your terminal. For nvm, fnm, Volta, asdf, mise, or a custom Node install, set an absolute path in:

- macOS: `~/Library/Application Support/hopper-pi/config.json`
- Windows: `%APPDATA%\hopper-pi\config.json`

macOS example:

```json
{
  "nodeExecutable": "/Users/you/.nvm/versions/node/v22.19.0/bin/node"
}
```

Windows example:

```json
{
  "nodeExecutable": "C:\\Program Files\\nodejs\\node.exe"
}
```

The configured file must exist and be executable. Hopper runs `node --version` with a three-second timeout and rejects malformed, prerelease, or older versions. `HopperCodeStatus` prints the resolved path, version, or exact resolution error.

### External Pi extension compatibility

Use `HopperCode` and its browser UI for Rhino and Grasshopper geometry work. The standalone Pi extension cannot connect directly to the shared Rhino transport. Every edit now requires a task with a captured document and host ownership; a connection profile alone does not grant that access. The extension source remains available for development, but the old direct geometry workflow is no longer supported.

The GHZMQ component preserves old definitions, but it does not start the transport or Node. No canvas component is required for Hopper.

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

### Develop the browser UI against Hopper

Run `pnpm host:dev`, then `pnpm ui:dev` in a second terminal. Vite reads the host endpoint from `~/.hopper/shared-control/control.json`. Start the host before Vite so the endpoint is available. `HOPPER_UI_PROXY_TARGET` can override it. If another host is already running, stop it through its browser UI before `pnpm host:dev` so the rebuilt host starts with development-origin access.

Run `HopperCode` in Rhino to attach its documents. To authenticate the development page, open the private `~/.hopper/shared-control/control.json` locally and copy its `browserCredential` value into `http://localhost:5173/#<browserCredential>`. The browser removes the fragment after reading it. Keep this credential private; do not paste it into logs, screenshots, issues, or chat. The normal HopperCode workflow opens an authenticated link automatically and needs none of these development steps.

Rebuild or reinstall the plugin manually:

```bash
pnpm run build:gh-plugin
# or force a full rebuild + copy:
node scripts/install-grasshopper-plugin.mjs --force
```

## Architecture

```
Browser UI  ⇄  private Hopper host + embedded Pi SDK  ⇄  authenticated ZMQ  ⇄  Rhino
                         ↑                                      ↑
                  exact local package                  per-Rhino runtime status
```

- `Hopper.Rhino.rhp` provides the four `HopperCode` commands and connects Rhino lifecycle services to the host process, browser launch, health checks, and shutdown policy.
- `Hopper.Core.dll` contains the Rhino-free protocol and lifecycle policies.
- `Hopper.Grasshopper.gha` registers Grasshopper operations only after Grasshopper loads. It preserves the existing GHZMQ component identity for old definitions.
- The host binds only `127.0.0.1`, checks the browser origin, and requires a 256-bit token as the first WebSocket message. The token begins in the URL fragment and is removed from browser history.
- Provider credentials use the global Pi auth file at `~/.pi/agent/auth.json` by default, including `PI_CODING_AGENT_DIR` overrides. Login, token refresh, and logout in Hopper update that shared file. Model settings remain in Hopper's private user-data directory. Task sessions and workspaces are isolated, with durable conversation and task state in the host journal.
- `HOPPER_SHARED_MAX_TOKENS` defaults to 1,000,000 tokens per root request, including its continuations and delegated tasks. The host checks recorded usage before starting another turn or child. Earlier requests do not consume a new request's budget.

The RPC socket uses ROUTER and DEALER framing, authenticates every request, and correlates replies by request ID. The loopback PUB/SUB socket carries advisory status wakeups. Node always rereads Rhino's full status after a wakeup. Treat the workstation account as the confidentiality boundary and do not expose these endpoints beyond loopback.

Rhino binds free loopback endpoints and writes them with a local connection token to an instance-specific profile. It also updates `connection.json` as a best-effort pointer to the last-started instance:

- Windows: `%APPDATA%\hopper-pi\connection.json`
- macOS: `~/Library/Application Support/hopper-pi/connection.json`

Each Rhino lifecycle also writes an authoritative instance profile under `hopper-pi/runtime/profiles/<lifecycle-instance-id>.json` and registers that exact path with the shared host, so concurrent Rhino processes do not depend on the last-writer-wins compatibility pointer. On later launches, Hopper deletes profiles only after verifying that the recorded PID and process start time no longer identify a live owner; malformed or uninspectable profiles are retained. Ephemeral logs use the sibling `<lifecycle-instance-id>.logs/` directory and are eligible for deletion seven days after death is verified.
Override profile discovery with `HOPPER_CONNECTION_PROFILE` for development.

## Tool controls and Firecrawl

Open **Agent tools** to enable or disable a group or an individual Hopper tool. Choices persist across conversations, restarts, and Rhino windows using the same profile. Group switches preserve child choices. In progressive mode, **Activate for this session** works even when tool discovery is disabled. **Check connection** refreshes a disconnected backend.

Firecrawl is bundled and disabled by default. Use **Manage API key** to save your own key, then turn on Firecrawl to add `web_search` and `web_fetch`. Saving a key leaves the enable switch unchanged. Requests send queries or URLs to Firecrawl and may consume your credits. Keys live in macOS Keychain, Windows Credential Manager, or Linux Secret Service, separate from settings and conversations. See [Firecrawl setup and limits](docs/firecrawl.md) and [storage and external Pi controls](docs/tool-policy-storage.md).

External Pi users can run `/hopper-tools`. Use `--hopper-config-dir /absolute/path` in external Pi or `--tool-config-dir /absolute/path` in the embedded host to select a separate profile. Firecrawl does not read API keys from environment variables.

Tool switches control named Hopper calls. An enabled general-purpose script tool can still perform equivalent operations, including network access; these switches are not a read-only or network sandbox.

## Agent tools (overview)

Open the first Rhino yourself and run `HopperCode` to connect it. Agents can create or open files in connected processes through `rh_document` and `gh_document`. No separate document grant is needed. On Windows, `new` replaces the current model; use `launchRhino` for an additional delegation target. It launches the connected installation with `/nosplash /notemplate /runscript="_HopperCode"`, preserves the coordinator's selected document, and waits for authenticated document readiness. Automatic worker startup does not open another browser tab; manually running `HopperCode` still does. A timed-out launch is checked again with the same request ID and is never automatically spawned again. Cancellation leaves an already started Rhino open. Default worker models use Rhino's built-in settings, so inspect units before modeling.

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
| `gh_inspect_data` | Bounded runtime input/output summaries, branch pages, and item pages |

`gh_inspect_data` starts with `{"targetId":"component-id"}` to return port types and counts without values. Use a returned port ID with `mode: "branches"`, then `mode: "items"` with a zero-based `branchIndex`. It reads cached solution data without recomputing; check phase, locked, and solver state before interpreting empty results. Runtime warnings remain in `gh_get_canvas_errors`.

All modes default to 20 rows, accept up to 100, and cap the inspection JSON at 8 KiB including the cursor. Strings are capped at 256 characters with truncation flags; scalars, points, and vectors expose values. Other geometry and unsupported/custom values return type-only summaries with `omitted: "unsupported_type"`. Inspection does not run item validators, custom formatters, or bounding-box calculations. Object wrappers expose only safe primitive/string values. `offset` jumps directly to a row. Continue with `{"cursor":"nextCursor-value"}` and optional `limit`; pages are never fetched automatically. Cursors expire when the document recomputes, objects are added/deleted, or the inspected component changes or expires. Refresh instead of mixing pages from different solutions. No data-tree snapshots are retained.

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
| `dotnet/Hopper.Rhino/` | Rhino lifecycle plug-in and `HopperCode` commands |
| `dotnet/Hopper.Grasshopper/` | Lazy Grasshopper operation adapter and passive GHZMQ compatibility component |
| `dotnet/Hopper.Core/` | Rhino/Grasshopper-free protocol, lifecycle, dispatch, and transport policies |
| `scripts/package-rhino.mjs` | Stage and verify a `mac-arm64` or `win-x64` package |
| `docs/` | Current runtime and tool references, plus reusable cookbook QA prompts |
| `mds/` | Skills and progressive reference docs for the agent |

Docs cover [shared host architecture and operation](docs/shared-host.md), [document management and native testing](docs/document-management.md), [script workspaces](docs/rhino-script-workspace.md), [tool controls](docs/tool-controls.md), and [plugin development](docs/plugins.md). Keep completed implementation plans, review notes, and dated test results in PRs rather than adding them to `docs/`.

## Environment variables

| Variable | Effect |
| -------- | ------ |
| `HOPPER_SKIP_GH_PLUGIN=1` | Skip plugin build/install on `pnpm install` |
| `HOPPER_GH_LIBRARIES` | Override Grasshopper Libraries install path |
| `HOPPER_GH_PLUGIN_DIR` | Subfolder under Libraries (default: `hopper-pi`) |
| `HOPPER_GH_STRICT=1` | Fail install on build/copy errors (default: warn and continue) |
| `HOPPER_CONNECTION_PROFILE` | Connection profile path override |
| `HOPPER_PI_AUTH_PATH` | Override the auth file; defaults to the global Pi `auth.json` |
| `HOPPER_PROGRESSIVE_TOOLS=1` | Opt in to a small Hopper core + `hopper_search_tools` (specialists activate on demand). Off by default. Also `--hopper-progressive-tools`. |
| `HOPPER_YAK` | Absolute Yak path when `package:rhino -- --target mac-arm64 --yak` or `--target win-x64 --yak` cannot find Rhino 8 |
| `HOPPER_NODE_EXECUTABLE` | Absolute Node executable path; highest resolver priority |

## Troubleshooting

- **Inspect tool schemas:** Run `/hopper-schemas` to browse the JSON schemas exposed to the agent for every registered tool (or `/hopper-schemas rh_run_script` / `/hopper-schemas all`). Dump them with `/hopper-schemas dump` (writes `tool-schemas.json` in the cwd). `/hopper-schemas sizes` reports catalog counts and compact schema bytes by group/tool.
- **`HopperCode` is unknown:** Install the generated `.yak`, rather than copying only the `.gha` to Grasshopper Libraries, then restart Rhino. A Rhino `.rhp` must be loaded for the command to exist.
- **Browser tab closed:** Run `HopperCode` again in the same Rhino instance to reopen the current conversation.
- **Browser host does not open:** Run `HopperCodeStatus`. It reports lifecycle state, host PID, Node resolution, handshake health, and startup errors without printing the secret URL.
- **Node is missing or unsupported:** Run `node --version` in a terminal. If Rhino cannot see the same installation, add its absolute path to Hopper's `config.json` as shown in [Choosing Node](#choosing-node), then run `HopperCodeRestart`.
- **Grasshopper did not open:** `HopperCode` intentionally leaves Grasshopper unloaded. Submit a `gh_*` request in the browser. Hopper warns before opening Grasshopper and waits for its active definition. Run `HopperCodeStatus` for a typed startup or document error.
- **Tools fail in external Pi mode:** Use the normal `HopperCode` browser UI. Standalone Pi connections cannot acquire shared task ownership.
- **Invalid connection token:** Run `HopperCodeStop`, then `HopperCode` to create a new instance profile and authenticated host connection.
- **Grasshopper shows offline in Rhino.Inside.Revit:** Keep Grasshopper visible while the agent is working and inspect `HopperCodeStatus` after refocusing Rhino. Older Rhino.Inside.Revit versions may still limit background Grasshopper work.
- **Plugin did not install:** Install [.NET 7 SDK](https://dotnet.microsoft.com/download), then run `pnpm run build:gh-plugin`. On Windows, set `HOPPER_GH_LIBRARIES` if auto-detect fails.
- **Stale plugin after `git pull`:** `node scripts/install-grasshopper-plugin.mjs --force`, then restart Rhino.

### Export the current conversation for debugging

Use the conversation export control to download its recorded task state. The authenticated endpoint is `GET /api/session/export?conversationId=<conversation ID>`.

The JSON format is `hopper-conversation-debug`, version 1. It includes the selected conversation, sessions, tasks, turns, inputs, questions, events, operations, recoveries, records, and dependencies. This is a point-in-time export. Wait for active tasks to finish for complete results.

Exporting does not start or change a task. Auth-store credentials are excluded, but conversation and tool content are not redacted. Review the file before sharing it.

## License

MIT — see [LICENSE](LICENSE).

### Native document tools

`rh_document` manages .3dm files and `gh_document` manages .gh/.ghx definitions. Both expose `list`, `get`, `getSettings`, `browse`, `new`, `open`, `activate`, `save`, `saveAs`, and `close`. Search for file, units, or tolerance in the progressive tool catalog. Read each host's returned capabilities for available native actions.

Document settings report model units, absolute/angle/relative tolerances, display precision, and separate layout settings. Grasshopper reports the Rhino context supplying effective settings and any association mismatch. Settings reads do not change the document.

File mutations use live document handles and optimistic state tokens. Paths are absolute; overwrites and unsaved changes are explicit. File transitions end the editing segment, so later geometry Undo or turn cancellation cannot undo a file save. After uncertain replies, the agent reconciles operation status and transaction ownership before further edits. Native platform and event-ordering verification remains required before release.
