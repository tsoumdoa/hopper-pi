# Progressive Hopper tools

Opt-in via `HOPPER_PROGRESSIVE_TOOLS=1` (also accepts `true`/`on`/`yes`). Default is **off**: all Hopper canvas tools stay active (pre-#27 behavior).

## Always-active core

When progressive mode is on, Hopper starts with:

- `rh_run_script`
- `rh_query_objects`
- `gh_get_canvas`
- `hopper_search_tools`

Built-in Pi tools and interaction tools (`ask_user`, `pick_option`) stay active. `rh_capture_view` remains model/consent gated and is composed additively with the core.

## Discoverable specialists

Use `hopper_search_tools` with a capability phrase (for example `edit script ports`, `connect wires`, `viewport camera`). Matches activate additively for the rest of the session and reset on `/new`.

Cap per request: `HOPPER_SEARCH_TOOL_LIMIT` (default 5, max 12).

## Schema size baseline

```bash
pnpm run report:tool-schemas
# or in Pi: /hopper-tool-sizes
```
