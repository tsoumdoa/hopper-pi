# hoppercode

`hoppercode` is a JSON CLI for agents and scripts that need to inspect or change Grasshopper and Rhino documents. It talks to a Grasshopper plugin over local ZeroMQ while Rhino is open.

The project is early. Commands and schemas may change between releases. Use dedicated files or backups when testing mutations.

Hopper is CLI-only. It does not load an agent extension, choose a model, manage a conversation, or ask the user questions. The calling agent or shell script owns that work.

## Requirements

- Rhino 8 on Windows or macOS
- .NET 7 SDK to build the Grasshopper plugin
- Node.js 20 or newer
- pnpm for source installs and development

## Install from source

The CLI-only package has not been published under its new npm name yet. Install it from this repository:

```bash
git clone https://github.com/tsoumdoa/hoppercode.git
cd hoppercode
pnpm install
pnpm run build
npm link
```

`pnpm install` builds the C# plugin and copies it into the Grasshopper Libraries directory unless `HOPPER_SKIP_GH_PLUGIN=1` is set.

Then:

1. Restart Rhino and Grasshopper.
2. Add the `Hopper Code Backend` component to the canvas. Its nickname is `GHZMQ`, under Params > Util.
3. Check the connection from a new shell.

```bash
hopper status --json
```

Rebuild or reinstall the plugin manually when needed:

```bash
pnpm run build:gh-plugin
node scripts/install-grasshopper-plugin.mjs --force
```

To install Node dependencies without building the plugin:

```bash
export HOPPER_SKIP_GH_PLUGIN=1
pnpm install
pnpm run build
```

## CLI commands

The CLI runs one command per process. Except for `--help` and `--version`, every invocation requires `--json` and writes one JSON object to stdout.

```bash
hopper status --json

hopper gh operations --json
hopper gh schema get-canvas --json
hopper gh schema list-components --json
hopper gh schema apply-graph --json
hopper gh call get-canvas --data '{}' --json
hopper gh call list-components \
  --data '{"queries":["curve length"],"searchFrom":"all","limit":5}' \
  --json
hopper gh call apply-graph --input graph.json --json

hopper rh operations --json
hopper rh schema query-objects --json
hopper rh schema run-script --json
hopper rh call query-objects --input query.json --json
hopper rh call run-script --input script.json --json
```

`operations` and `schema` work without Rhino. Calls that inspect or change a document require a running Hopper backend.

### Supported operations

| Operation | Purpose | Mutation behavior |
| --- | --- | --- |
| `gh_get_canvas` | Inspect the connected Grasshopper canvas | Read only |
| `gh_list_components` | Search component types loaded by Grasshopper | Read only |
| `gh_apply_graph` | Create and validate one Grasshopper subgraph | Backend rollback on known apply failures |
| `rh_query_objects` | Inspect objects in the active Rhino document | Read only |
| `rh_run_script` | Run Rhino command, Python, or C# items in order | Non-atomic mutation |

The CLI does not expose the older Pi-only editing, viewport, screenshot, prompt, or progressive-loading tools.

### Input

Every `call` accepts exactly one JSON input source:

```bash
hopper gh call get-canvas --data '{}' --json
hopper gh call apply-graph --input graph.json --json
hopper rh call query-objects --input - --json < query.json
```

The JSON root must be an object. Input is limited to 1 MiB. The CLI rejects conflicting or repeated input flags, invalid UTF-8, trailing content, unknown fields, and schema errors before it contacts the backend.

Use `schema` to get the exact draft 2020-12 input and output schemas. `gh_list_components` returns full component type GUIDs so a later process can pass them to `gh_apply_graph`.

### Output and exit codes

A successful response has this general shape:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "command": "gh.call",
  "operation": "gh_get_canvas",
  "outcome": "succeeded",
  "message": "Connected Grasshopper canvas inspected",
  "target": {},
  "data": {},
  "error": null
}
```

Fields inside `target` identify the backend instance, connected Grasshopper document, and active Rhino document observed during execution.

| Exit code | Meaning |
| --- | --- |
| `0` | Success |
| `2` | Invalid command, input, schema, or operation |
| `3` | Backend unavailable or authentication failed |
| `4` | Known operation failure |
| `5` | Mutation outcome unknown or possibly partial |
| `70` | Internal CLI error before a mutation was sent |

The CLI never retries a mutation. A timeout, interruption, dropped response, or malformed response after mutation send begins returns `outcome: "unknown"` and exit code `5`. Inspect the document with `gh_get_canvas` or `rh_query_objects` before deciding whether to retry.

`rh_run_script` runs items in order. An earlier item or part of a failing script may have changed the Rhino document. The command does not promise one undo record across its items.

## Document targeting

The Grasshopper backend serves the document that owns the active `Hopper Code Backend` component. That document may differ from the Grasshopper window currently in front.

Rhino operations use the active Rhino document at execution time. Run `hopper status --json` before a mutation and check the `target` returned afterward. Hopper does not yet lock a command to a saved document identity.

## Architecture

```text
agent or shell script
  -> hopper CLI
  -> typed operation registry
  -> ZeroMQ REQ/REP
  -> Hopper Code Backend in Grasshopper
  -> connected Grasshopper document and active Rhino document
```

The CLI uses the request endpoint for all supported operations. The backend writes its current endpoints, instance metadata, and local authentication token to a user-local connection profile.

New installs use:

- Windows: `%APPDATA%\hoppercode\connection.json`
- macOS: `~/Library/Application Support/hoppercode/connection.json`
- Linux: `~/.local/share/hoppercode/connection.json`
- Linux with XDG: `$XDG_DATA_HOME/hoppercode/connection.json`

For one compatibility window, the CLI also reads the former `hopper-pi/connection.json` path when the new path does not exist. Set `HOPPER_CONNECTION_PROFILE` to choose an exact file and bypass default discovery.

The profile token stays local. Hopper does not include it in JSON responses, errors, or diagnostics.

## Environment variables

| Variable | Effect |
| --- | --- |
| `HOPPER_SKIP_GH_PLUGIN=1` | Skip plugin build and installation during `pnpm install` |
| `HOPPER_GH_LIBRARIES` | Override the Grasshopper Libraries directory |
| `HOPPER_GH_PLUGIN_DIR` | Override the plugin subdirectory, which defaults to `hoppercode` |
| `HOPPER_GH_STRICT=1` | Fail installation on build or copy errors instead of warning |
| `HOPPER_CONNECTION_PROFILE` | Use an exact connection profile path |
| `GH_ZMQ_REQ` | Override the ZeroMQ request endpoint |
| `GH_ZMQ_TOKEN` | Supply the token for a manually configured endpoint |

The plugin may still write publish and command endpoints into the profile for protocol compatibility. The CLI does not use them.

## Development

```bash
pnpm install
pnpm run build
pnpm test
node dist/cli/main.js --help
```

Useful plugin checks:

```bash
dotnet build grasshopper-plugin/rhino-zmq-poc.csproj -f net7.0 --no-restore
dotnet build grasshopper-plugin/rhino-zmq-poc.csproj -f net7.0-windows --no-restore
```

Package checks:

```bash
npm pack --dry-run
npm link
hopper --version
```

## Repository layout

| Path | Role |
| --- | --- |
| `src/cli/` | Command parsing, JSON input, output, and process lifecycle |
| `src/core/` | Operation registry, contracts, schemas, and validation |
| `src/infra/` | Connection profile and ZeroMQ request transport |
| `src/services/` | Grasshopper and Rhino parsing, validation, and operation helpers |
| `grasshopper-plugin/` | C# Grasshopper plugin and ZeroMQ backend |
| `scripts/` | TypeScript build and plugin installation scripts |

## Troubleshooting

### Backend unavailable

Confirm that Rhino and Grasshopper are running and that the canvas contains an active `Hopper Code Backend` component. Then run:

```bash
hopper status --json
```

If the plugin selected a fallback port, the CLI reads it from the connection profile. Check `HOPPER_CONNECTION_PROFILE` and `GH_ZMQ_REQ` if you override discovery.

### Authentication failed

Restart the CLI command after the backend has started so it reads the current profile. If `GH_ZMQ_REQ` points at a token-protected backend, set `GH_ZMQ_TOKEN` too.

### Plugin did not install

Install the .NET 7 SDK, then run:

```bash
pnpm run build:gh-plugin
```

On Windows, set `HOPPER_GH_LIBRARIES` if automatic directory detection fails.

### Plugin is stale after an update

```bash
node scripts/install-grasshopper-plugin.mjs --force
```

Restart Rhino after the copy completes.

## License

MIT. See [LICENSE](LICENSE).
