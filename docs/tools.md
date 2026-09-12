# Agent tools

Open **Agent tools** to enable or disable a group or an individual Hopper tool. Choices persist across conversations, restarts, and Rhino windows using the same profile. Group switches preserve child choices. In progressive mode, **Activate for this session** works even when tool discovery is disabled. **Check connection** refreshes a disconnected backend.

Firecrawl is bundled and disabled by default. Use **Manage API key** to save your own key, then turn on Firecrawl to add `web_search` and `web_fetch`. Saving a key leaves the enable switch unchanged. Requests send queries or URLs to Firecrawl and may consume your credits. Keys live in macOS Keychain, Windows Credential Manager, or Linux Secret Service, separate from settings and conversations. See [Firecrawl setup and limits](firecrawl.md) and [storage and external Pi controls](tool-policy-storage.md).

Tool switches control named Hopper calls. An enabled general-purpose script tool can still perform equivalent operations, including network access; these switches are not a read-only or network sandbox.

Open the first Rhino yourself and run `HopperCode` to connect it. Agents can create or open files in connected processes through `rh_document` and `gh_document`. No separate document grant is needed. On Windows, `new` replaces the current model; use `launchRhino` for an additional delegation target. It launches the connected installation with `/nosplash /notemplate /runscript="_HopperCode"`, preserves the coordinator's selected document, and waits for authenticated document readiness. Automatic worker startup does not open another browser tab; manually running `HopperCode` still does. A timed-out launch is checked again with the same request ID and is never automatically spawned again. Cancellation leaves an already started Rhino open. Default worker models use Rhino's built-in settings, so inspect units before modeling.

## Rhino

| Tool | Role |
| ---- | ---- |
| `rh_run_script` | Rhino commands, Python, or C# on the active document |
| `rh_query_objects` | List/count objects (short IDs for GH params) |
| `rh_view_control` | Viewport, projection, camera, CPlane view, and zoom |
| `rh_capture_view` | Optional viewport screenshot for multimodal models |

## Grasshopper editing

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

## Grasshopper queries

| Tool | Role |
| ---- | ---- |
| `gh_get_canvas` | Canvas layout and component snapshot |
| `gh_list_components` | Search component library by keyword |
| `gh_get_canvas_errors` | Runtime messages plus component-overlap checks |
| `gh_inspect_data` | Bounded runtime input/output summaries, branch pages, and item pages |

`gh_inspect_data` starts with `{"targetId":"component-id"}` to return port types and counts without values. Use a returned port ID with `mode: "branches"`, then `mode: "items"` with a zero-based `branchIndex`. It reads cached solution data without recomputing; check phase, locked, and solver state before interpreting empty results. Runtime warnings remain in `gh_get_canvas_errors`.

All modes default to 20 rows, accept up to 100, and cap the inspection JSON at 8 KiB including the cursor. Strings are capped at 256 characters with truncation flags; scalars, points, and vectors expose values. Other geometry and unsupported/custom values return type-only summaries with `omitted: "unsupported_type"`. Inspection does not run item validators, custom formatters, or bounding-box calculations. Object wrappers expose only safe primitive/string values. `offset` jumps directly to a row. Continue with `{"cursor":"nextCursor-value"}` and optional `limit`; pages are never fetched automatically. Cursors expire when the document recomputes, objects are added/deleted, or the inspected component changes or expires. Refresh instead of mixing pages from different solutions. No data-tree snapshots are retained.

## User questions

| Tool | Role |
| ---- | ---- |
| `pick_option` | Ask the user to choose among informed options |
| `ask_user` | Ask a free-text question when options are not practical |

## Progressive loading

| Tool | Role |
| ---- | ---- |
| `hopper_search_tools` | Search the Hopper catalog and activate specialists (`HOPPER_PROGRESSIVE_TOOLS=1` / `--hopper-progressive-tools`) |

Bundled Pi skills and progressive reference docs live under `mds/` (`gh-modeling-expert`, `rhino-document`, `gh-cookbook`, and `gh-reference`).

For new Grasshopper builds, the canonical workflow is: resolve unusual or ambiguous types if needed, call `gh_apply_graph` once, inspect its integrated runtime/overlap validation, then use legacy tools only for surgical repair. `gh_get_canvas` remains for existing canvases, selections, and subgraphs.

## Document tools

`rh_document` manages .3dm files and `gh_document` manages .gh/.ghx definitions. Both expose `list`, `get`, `getSettings`, `browse`, `new`, `open`, `activate`, `save`, `saveAs`, and `close`. Search for file, units, or tolerance in the progressive tool catalog. Read each host's returned capabilities for available native actions.

Document settings report model units, absolute/angle/relative tolerances, display precision, and separate layout settings. Grasshopper reports the Rhino context supplying effective settings and any association mismatch. Settings reads do not change the document.

File mutations use live document handles and optimistic state tokens. Paths are absolute; overwrites and unsaved changes are explicit. File transitions end the editing segment, so later geometry Undo or turn cancellation cannot undo a file save. After uncertain replies, the agent reconciles operation status and transaction ownership before further edits. Native platform and event-ordering verification remains required before release.

See [document management](document-management.md) and [script workspaces](rhino-script-workspace.md) for details.
