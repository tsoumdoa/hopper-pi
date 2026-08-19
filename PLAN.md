# Hopper CLI-only plan

## Goal

Turn this PR into a CLI-only Hopper package. Remove the Pi extension, its adapters, session behavior, UI, bundled skills, package metadata, and runtime dependencies. Keep the Grasshopper plugin and the one-shot `hopper` JSON CLI.

This replaces the earlier coexistence plan. The PR will not preserve Pi compatibility or compare the CLI against Pi.

## Product boundary

The supported path is:

```text
shell-based agent or human caller
  -> hopper CLI
  -> typed operation registry
  -> bounded ZeroMQ request transport
  -> existing Grasshopper plugin
  -> connected Grasshopper document and active Rhino document
```

The caller owns conversation, planning, and user interaction. Each CLI invocation performs one command, prints one JSON response, and exits.

The Grasshopper plugin remains required. This PR does not replace the ZeroMQ protocol, convert the `.gha` into an `.rhp`, or add a persistent CLI daemon.

## Supported CLI scope

Keep the five operations already implemented in this PR:

| CLI operation | Internal operation | Behavior |
| --- | --- | --- |
| `gh call get-canvas` | `gh_get_canvas` | Inspect the connected Grasshopper canvas |
| `gh call list-components` | `gh_list_components` | Search installed Grasshopper component types |
| `gh call apply-graph` | `gh_apply_graph` | Create and validate a Grasshopper subgraph |
| `rh call query-objects` | `rh_query_objects` | Inspect objects in the active Rhino document |
| `rh call run-script` | `rh_run_script` | Run ordered Rhino command, Python, or C# items |

Also keep:

- `hopper status --json`
- offline operation discovery through `hopper gh operations --json` and `hopper rh operations --json`
- offline input and output schema discovery
- file, stdin, and inline JSON input
- target identity on backend responses
- bounded requests, cancellation, runtime response validation, and conservative mutation outcomes
- the `hopper` executable and Grasshopper plugin installer

Do not migrate the other Pi tools in this PR. Delete them with the extension. Adding more CLI operations can happen in later PRs through the same registry.

## CLI contracts

Public operation names use kebab case. Internal operation names retain their current `gh_*` and `rh_*` names.

Every call accepts exactly one input source:

- `--input path.json`
- `--input -`
- `--data '{...}'`

Reject missing or repeated input flags, multiple input sources, arrays, scalar roots, unknown properties, invalid UTF-8, trailing content, and inputs over 1 MiB. Validate all local rules before contacting the backend.

With `--json`, stdout contains exactly one JSON object followed by a newline. Diagnostics go to stderr. Only `--help` and `--version` may emit plain text.

Keep the current response union and exit codes:

| Exit code | Meaning |
| --- | --- |
| `0` | Success |
| `2` | Invalid command, input, schema, or operation |
| `3` | Backend unavailable or authentication failed |
| `4` | Known operation failure |
| `5` | Mutation outcome unknown or possibly partial |
| `70` | Internal CLI error before a mutation was sent |

The CLI must not retry mutations. If a transport or response failure occurs after mutation send begins, return `outcome: "unknown"` unless a validated backend response proves that no document change occurred. Tell the caller which read operation to use before deciding whether to retry.

`gh_apply_graph` retains backend rollback behavior. `rh_run_script` remains non-atomic and makes no per-turn undo promise.

## Complete Pi removal

### Package metadata and dependencies

- Remove the `pi` manifest from `package.json`.
- Remove the `pi-package` keyword and the `pi` script.
- Point `dev` at the CLI instead of `src/index.ts`.
- Remove `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, and `@earendil-works/pi-tui`.
- Remove Pi peer-resolution entries from `pnpm-workspace.yaml`.
- Remove dependencies such as `chalk` and `nanoid` if nothing in the CLI or installer uses them after cleanup.
- Regenerate both lockfiles and verify that no Pi package remains in either dependency graph.

Use `hoppercode` as the CLI product name in package metadata and docs. Keep the executable name `hopper`. If publication under a new npm package name is not part of this PR, record that separately rather than retaining Pi extension metadata.

### Extension entry points and UI

Delete:

- `src/index.ts`
- `src/extensions/choices/`
- `src/ui/`
- Pi-only backend status presentation and tool schema commands
- Pi model selection, viewport consent prompts, prompt routing, and progressive tool activation
- Pi session start, agent turn, transaction, and shutdown hooks

There must be no `ExtensionAPI`, `ExtensionContext`, `defineTool`, `AgentToolResult`, Pi TUI component, or `pi.register*` usage left in source or tests.

### Tool adapters and unused operations

Delete Pi tool definitions and their adapter-only helpers. This includes the progressive catalog, user-choice tools, tool renderers, backend guards, and operations outside the supported five-command CLI set.

Some reusable logic currently sits under `src/tools/` or in a module that also imports Pi-only code. Move only the logic reached by the five CLI operations into neutral `src/core/`, `src/services/`, or `src/presenters/` modules before deleting the adapters. In particular:

- move canvas checks and component filtering constants out of `src/tools/`
- split apply-graph validation and normalization away from the Pi execution wrapper
- keep parsing, component search, graph resolution, Rhino GUID handling, and script validation independent of agent SDK types
- replace Pi content-array result types with plain TypeScript data types
- delete prose formatters that only existed to render Pi tool responses

After the move, the CLI registry must not import anything from an extension or agent-adapter directory.

### Pi transport and session infrastructure

Keep the REQ/REP requester used by the CLI. Delete command, publish, subscribe, cached UI status, and transaction infrastructure that only supported Pi agent-turn lifecycle behavior.

Before deleting an infrastructure module, verify it is unreachable from:

- `src/cli/`
- the CLI operation registry
- the Grasshopper plugin installer
- standalone maintenance scripts that remain supported

The CLI does not inherit Pi's paired transaction sockets or one-undo-step-per-agent-turn behavior. Operation and schema descriptions must state the actual per-call behavior.

### Bundled Pi content

- Remove Pi skills and references from package files.
- Delete `mds/skills/` and other content whose only consumer was the Pi extension.
- Keep general project documentation only if it describes the CLI, ZeroMQ backend, Grasshopper graph format, or contributor workflow without assuming Pi.
- Delete tests and fixtures for removed Pi behavior. Preserve or rewrite tests for reusable parsers, validators, and CLI operations.

### Branding and compatibility identifiers

Rewrite the README around CLI installation, plugin installation, command discovery, schemas, JSON examples, exit codes, document targeting, and mutation safety. Remove `pi install`, `pnpm run pi`, Pi architecture diagrams, Pi session instructions, and claims about automatic tool registration.

Rename user-facing `hopper-pi` labels to Hopper or `hoppercode`. The connection profile directory and Grasshopper library folder are persisted integration identifiers, not extension code. Migrate them safely:

1. Make new installs write to a Hopper-named directory.
2. Let the CLI read the old `hopper-pi` connection profile as a fallback for one compatibility window.
3. Prefer an explicit connection-profile environment variable over either default.
4. Do not silently delete or move an existing profile or installed plugin directory.

Document the fallback as a legacy storage path. It must not require Pi or load extension code.

## Implementation sequence

### 1. Lock the CLI boundary

- Keep fixtures for the five input and output schemas.
- Keep stable response envelopes, error codes, exit codes, and target identity.
- Add a source-level dependency test that fails if CLI-reachable modules import a Pi package or extension adapter.
- Record the five supported operations in one registry fixture so deletions cannot change the command set accidentally.

Checks:

- schema and operation discovery work without the backend
- invalid local input makes zero backend requests
- every successful operation output passes its declared runtime schema
- tokens and raw script sources do not appear in errors or fixtures

### 2. Detach the operation core

- Move the CLI's reusable checks, constants, validation, and normalization out of Pi tool modules.
- Make each operation return structured data through `OperationResult`.
- Remove all Pi result formatting from the execution path.
- Keep target identity and unknown-outcome handling at the operation boundary.

Checks:

- the operation registry imports no file that imports an `@earendil-works/pi-*` package
- a full component type GUID found in one process works in `gh_apply_graph` from another process
- malformed backend responses cannot become successes
- local graph validation finishes before component lookup or mutation

### 3. Delete the Pi extension

- Remove extension entry points, adapters, UI, skills, session services, transaction hooks, and unused tool implementations.
- Remove or rewrite their tests.
- Remove dead files and dependencies found by reachability and import searches.
- Run TypeScript with unused-code checks during this cleanup so stale imports do not hide leftovers.

Checks:

- `rg` finds no Pi SDK import, Pi extension manifest, or extension registration call
- the build emits the CLI and supporting modules, not an extension entry point
- the test suite contains no fake Pi API or Pi session lifecycle fixture

### 4. Finish CLI-only packaging and docs

- Update package identity, scripts, files, keywords, and lockfiles.
- Keep `bin.hopper` mapped to the built CLI and preserve executable permissions.
- Update the installer and connection profile naming with the legacy read fallback.
- Rewrite README examples and the PR description for the CLI-only product.

Checks:

- `npm pack --dry-run` contains the CLI, required runtime modules, plugin source or installer assets, and no Pi extension content
- a fresh-prefix install exposes `hopper` outside the repository
- package installation does not install a Pi SDK transitively
- help and version are plain text; every other path emits one JSON object

### 5. Verify transport and live behavior

Use a fake backend for offline, authentication, timeout, abort, dropped mutation response, malformed response, invalid payload, and repeated-call leak tests. Keep the existing target identity contract tests in the Grasshopper plugin.

Run a small live smoke test against dedicated Rhino and Grasshopper files:

1. Check status and target identity.
2. Discover operations and schemas from a fresh shell.
3. Inspect the connected canvas.
4. Search for a component, apply a small graph with its full GUID, and inspect the result.
5. Query Rhino objects.
6. Create one uniquely named Rhino object with `run-script`, then verify it with `query-objects`.
7. Confirm an offline backend returns exit code `3`.
8. Confirm a dropped mutation response returns exit code `5` and does not trigger a retry.

Do not compare these results with Pi. The purpose is to verify the supported CLI path after Pi removal.

## Acceptance criteria

The PR is ready when all of these are true:

- no Pi SDK package is declared, installed, imported, or bundled
- no Pi extension entry point, manifest, tool registration, UI, session hook, skill, or adapter remains
- the only supported Node entry point is the `hopper` CLI
- all five CLI operations and their offline schemas remain available
- every non-help invocation writes exactly one parseable JSON object to stdout
- invalid local input contacts no backend
- backend responses pass runtime validation before use
- no unknown mutation is reported as succeeded or safely failed
- no mutation is retried automatically
- target identity is present on validated backend operation responses
- the CLI and Grasshopper plugin agree on the new connection profile location, with documented legacy fallback
- build, TypeScript checks, unit tests, C# contract builds, package dry-run, and fresh-install smoke tests pass
- README and PR text describe a CLI plus Grasshopper plugin, with no Pi setup or runtime claims

Any remaining runtime dependency on Pi, extension load path, false mutation success, secret leak, malformed stdout response, or wrong-document mutation blocks the PR.

## Deferred work

- migration of operations beyond the five-command set
- persistent sessions, saved document bindings, and atomic target preconditions
- history, reconciliation, journals, checkpoints, diff, undo, and redo
- CLI transaction grouping beyond current `gh_apply_graph` behavior
- a new router protocol or `.rhp` conversion
- Yak packaging and full cross-platform installer certification
- human-readable output and interactive prompts
- publication or deprecation handling for the old npm package name
