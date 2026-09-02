# Self-host Pi Rhino fix plan

This plan turns the decisions in [the review feedback](./self-host-pi-rhino-pr-review-feedback.md) into implementation work. It also includes unresolved findings from [the original PR review](./self-host-pi-rhino-pr-review.html) that were not called out in the feedback.

## Goals

- Make HopperCode startup, status, restart, and shutdown predictable.
- Keep networking and process waits off Rhino's UI thread.
- Give Rhino and Grasshopper work one ordered, bounded execution path with real completion results.
- Let the agent detect and initialize Grasshopper before using Grasshopper tools.
- Ship small, clean packages for each supported operating system and CPU.
- Reorganize the proof-of-concept layout around the code's current responsibilities.

The work is complete only when the runtime behavior, package contents, and test matrix meet the acceptance criteria at the end of this document.

## Decisions from the feedback

1. Rename the user-facing Rhino command from `Hopper` or `_Hopper` to `HopperCode`.
2. Add `HopperCodeStop`, `HopperCodeStatus`, and `HopperCodeRestart`.
3. Running `HopperCode` while the same instance is active must not start another backend or Node process. It should print an "already running" message and the current state.
4. Node is a prerequisite. Do not include a Node executable in the Yak package.
5. Document Node `22.19.0` as the minimum supported version, matching `package.json`. Startup must enforce the same version.
6. Produce separate release payloads for macOS and Windows, split again by CPU. Each payload contains only its matching ZeroMQ native module.
7. Do not ship tests, source maps, scripts used only by development, stale build output, lockfiles, workspace files, or unrelated compiled modules.
8. Give all NetMQ sockets one dedicated owner thread.
9. Move graceful shutdown waits and process joins off Rhino's UI thread.
10. Add a typed `getRuntimeStatus` request and an idempotent, agent-callable way to load Grasshopper.
11. Replace the current mutation and query split with one bounded, ordered main-thread dispatcher that reports actual completion.
12. Adopt the folder and project split proposed in the review.

## Additions beyond the feedback

The plan also keeps several findings that the feedback did not explicitly address:

- Automatic recovery after a Node crash or repeated health-check failure.
- A retention policy and safe cleanup for stale profiles and instance data.
- Hermetic .NET unit tests plus a separate live Rhino integration suite.
- Real macOS tests for code paths that currently use Windows-oriented drawing APIs.
- A versioned C#/TypeScript contract with shared fixtures.
- Package allowlist and size checks in CI.
- Reliable Node discovery for GUI-launched Rhino, where the shell `PATH` may be unavailable.
- A deliberate compatibility policy for the legacy Grasshopper component and its saved-file GUID.

## Phase 1: Define the lifecycle and wire contract

Do this first because commands, recovery, the browser, and tests all depend on the same states.

### Runtime state model

Create one lifecycle controller owned by `HopperRhinoPlugin`. It coordinates the backend transport and the Node host. Use explicit states rather than independent booleans:

```text
stopped -> starting -> running -> stopping -> stopped
                \-> degraded
                \-> faulted
running -> degraded -> recovering -> running
running -> exited
```

Every transition records a timestamp and a short error code or reason when applicable. The controller must serialize start, stop, and restart calls so two Rhino commands cannot race each other.

### Command behavior

| Command | Required behavior |
| --- | --- |
| `HopperCode` | Start the bridge and host if stopped. If starting or running, do not launch anything else. Print the current state and existing browser URL when available. |
| `HopperCodeStop` | Signal host and transport shutdown, return control to Rhino promptly, and finish bounded cleanup in the background. Repeated calls are safe. |
| `HopperCodeStatus` | Print lifecycle state, Node PID and health, Rhino readiness, transport readiness, Grasshopper load state, active document state, queue depth, and the last error. It must not start anything. |
| `HopperCodeRestart` | Serialize a stop followed by a fresh start. Never overlap the old and new transport or Node process. Report a typed failure if either half fails. |

Give all four commands stable command GUIDs. Remove the old user-facing command name unless a compatibility requirement is found before release. Keep lifecycle logic out of the command classes so the same behavior can be component-tested.

### Typed runtime status

Add a versioned `getRuntimeStatus` protocol response with at least these fields:

```ts
type RuntimeStatus = {
  protocolVersion: number;
  lifecycle: "stopped" | "starting" | "running" | "stopping" |
    "degraded" | "recovering" | "faulted" | "exited";
  rhino: {
    ready: boolean;
    activeDocument: boolean;
    documentName?: string;
  };
  transport: {
    ready: boolean;
    instanceId?: string;
  };
  grasshopper: {
    installed: boolean;
    state: "not_loaded" | "loading" | "loaded" | "failed";
    componentServerReady: boolean;
    activeDocument: boolean;
    documentName?: string;
  };
  dispatcher: {
    accepting: boolean;
    depth: number;
    capacity: number;
  };
  host: {
    state: string;
    processId?: number;
    healthy?: boolean;
  };
  shuttingDown: boolean;
  lastError?: { code: string; message: string };
};
```

Rhino owns the Grasshopper status source. On Rhino's UI thread, a tracker checks the registered Grasshopper plug-in ID with `PlugIn.PlugInExists`, then checks `Grasshopper.Instances.IsComponentServer` and `ActiveCanvas?.Document` only when Rhino reports the plug-in as loaded. Canvas and document events update an immutable snapshot. `getRuntimeStatus` reads that snapshot without calling Rhino or Grasshopper APIs from the NetMQ thread. The Node host adds its process and health fields before returning the combined status to the agent or browser.

The C# and TypeScript definitions must be generated from one schema or checked against shared protocol fixtures. Increment the protocol version for incompatible changes and fail with a clear version mismatch instead of trying to continue.

## Phase 2: Make Node an external prerequisite and clean the packages

### Resolve and validate Node

Replace bundled-runtime discovery in `HopperHostManager` with a `NodeRuntimeResolver` that:

1. Checks an explicit `HOPPER_NODE_EXECUTABLE` absolute path first.
2. Checks a persisted HopperCode setting if one is added for GUI installations.
3. Resolves `node` from the process environment and a small documented set of standard installation paths.
4. Runs the resolved executable with `--version` off the UI thread.
5. Rejects versions older than `22.19.0` with `NODE_VERSION_UNSUPPORTED`.
6. Rejects a missing or non-executable path with `NODE_NOT_FOUND` and points the user to the correct installation section.
7. Records the resolved absolute path and version in `HopperCodeStatus`.

The macOS fallback is necessary because an app started from Finder often has a different `PATH` from Terminal. Do not invoke Node through a shell. Launch the validated absolute executable directly.

### Documentation

Add prerequisite and installation pages for:

- macOS arm64
- macOS x64
- Windows x64
- Windows arm64, only if Rhino, the build toolchain, and ZeroMQ artifact are all verified on it

Each page must show how to install Node, verify `node --version`, configure an explicit path when Rhino cannot find it, install the matching Yak, run `HopperCodeStatus`, and recover from version or CPU mismatch errors.

### Target-specific release build

Change `scripts/package-rhino.mjs` to require an explicit target such as `mac-arm64`, `mac-x64`, or `win-x64`. Then:

- Remove Node download, checksum, extraction, manifest selection, and bundled binary code.
- Start from an empty staging directory.
- Run a release-only TypeScript build that excludes tests and source maps.
- Copy files through an allowlist instead of copying all of `dist` and the repository metadata.
- Copy only the ZeroMQ native artifact for the requested OS and CPU.
- Keep `package.json` only where Node ESM or dependency resolution requires it.
- Remove the unused direct `chalk` dependency.
- Fail packaging if tests, maps, stale output, lockfiles, the workspace file, the Grasshopper installer, a Node executable, or a wrong-target native module appears.
- Record total staged and Yak sizes in CI. Fail when either exceeds an agreed per-target budget.

Do not attempt aggressive bundling of the Pi dependency tree in this change. Dynamic imports and native modules make that a separate, higher-risk optimization.

## Phase 3: Give NetMQ a single owner

Replace the current socket creation and worker-task split with one dedicated transport thread or one `NetMQPoller` thread. That owner must:

- Create, bind, poll, unbind, and dispose every PUB, request, and command socket.
- Write the connection profile only after all required sockets bind successfully.
- Receive commands and requests, validate authentication and protocol version, then hand admitted work to thread-safe queues.
- Receive completion messages from the dispatcher through `NetMQQueue` or another thread-safe handoff and send responses from the owner thread.
- Drain outbound events without another thread touching the PUB socket.
- Delete only the connection profile owned by its verified instance.
- Stop from a cancellation signal and enforce a short, measured join deadline outside the Rhino UI thread.

No NetMQ socket reference may escape the transport owner. Add assertions or internal ownership checks where practical.

## Phase 4: Replace `JobQueue` with one ordered dispatcher

All mutations and document-sensitive queries must enter the same FIFO dispatcher. Health checks and immutable status snapshots may bypass it.

Each work item contains:

- a correlation ID
- operation name and arguments
- required capability, either Rhino or Grasshopper
- enqueue time and deadline
- cancellation state
- a completion source for the result

Use a bounded queue. Start with a capacity of 64 and keep it configurable for tests. Reject overflow immediately with `BUSY`, including current depth and capacity.

The Rhino UI pump executes one item per callback, then reposts if work remains. Do not drain the full queue in one callback. Measure callback duration in integration tests and add a small time-budget option only if single operations can safely yield.

Return explicit terminal results:

- `COMPLETED`
- `FAILED`
- `BUSY`
- `CANCELLED_BEFORE_START`
- `DEADLINE_EXCEEDED_BEFORE_START`
- `OUTCOME_UNKNOWN` when the caller times out after execution began
- `CAPABILITY_UNAVAILABLE`
- `NO_ACTIVE_GRASSHOPPER_DOCUMENT`
- `SHUTTING_DOWN`

Node tool promises resolve or reject from that correlated completion, not when ZeroMQ accepts a send. A mutation followed by a document query must therefore observe the mutation.

Either use the existing subscriber code for completion events or remove it after the new response path lands. Do not leave two completion mechanisms in production.

## Phase 5: Let the agent start Grasshopper on demand

`HopperCode` must not load or open Grasshopper. It starts only the bridge and Node host, so Rhino-only work does not pay Grasshopper's startup cost.

Add an idempotent `startGrasshopper` operation in the Rhino bridge. It must schedule the supported `_Grasshopper` command on Rhino's command or UI thread and return one of `started`, `already_running`, or a typed failure. Do not call Rhino's command runner from an event callback.

Before the agent invokes a `gh_*` tool, the Node side follows this flow:

1. Call `getRuntimeStatus`.
2. If `grasshopper.state` is `not_loaded`, call `startGrasshopper` once.
3. Wait for the event-backed status to reach `loaded` with the component server ready, subject to a startup deadline.
4. Recheck active-document state, then submit the original tool call or return a typed readiness error.

The Node side must coalesce simultaneous starts so several `gh_*` calls produce one `startGrasshopper` request. This is lazy startup and recovery, not a polling loop.

Keep Grasshopper load state separate from active document state. Starting Grasshopper on demand is the agent's responsibility. Creating or selecting a Grasshopper document is user state, so the agent must not call `AddNewDocument` behind the user's back. When Grasshopper is loaded without an active document:

- Rhino-only tools remain available.
- Grasshopper tools return `NO_ACTIVE_GRASSHOPPER_DOCUMENT`.
- The browser explains that the user must open or create a Grasshopper document.
- Queued Grasshopper work expires at its deadline rather than waiting forever.

Update status from Grasshopper canvas and document lifecycle events. Use an idle fallback only for a state that has no reliable event.

## Phase 6: Make shutdown and recovery safe

### Non-blocking shutdown

On `HopperCodeStop` or Rhino closing:

1. Atomically enter `stopping` and reject new work.
2. Cancel queued items that have not started.
3. Signal Node and the transport owner without waiting on the UI thread.
4. Allow a short graceful-shutdown deadline on a background task.
5. Kill the verified Node process tree if it misses the deadline.
6. Join the transport thread off-main and dispose remaining resources on their owner threads.
7. Publish the final stopped state when Rhino is still open.

Rhino's closing event must only signal shutdown and schedule bounded cleanup. It must not perform synchronous HTTP, `WaitForExit`, task joins, or socket disposal.

### Host recovery

Health failures must change lifecycle state. Add a bounded restart policy for unexpected Node exit or repeated failed health probes:

- Use exponential backoff with jitter and a small maximum retry count.
- Never recover while the user requested stop or Rhino is closing.
- Never run more than one child process.
- Reset the retry count after a stable healthy interval.
- Move to `faulted` after retries are exhausted and show the next action in `HopperCodeStatus` and the browser.

`HopperCodeRestart` bypasses the automatic backoff only after it has fully stopped the prior instance.

### State retention and stale data

Choose and document one session-continuity policy before release. The least surprising first version is to preserve user workspace data but start a fresh live session for each Rhino process. Clean connection profiles and temporary instance folders only after verifying that their owner PID is dead and the files exceed a retention age. Never delete an active instance's data based only on age.

## Phase 7: Reorganize the code

Move files without changing saved Grasshopper component identity:

```text
src/
├── host/                 process, HTTP and WebSocket, Pi session
├── extension/
│   ├── transport/        ZeroMQ clients
│   ├── tools/            Pi tools
│   ├── services/         tool behavior
│   └── ui/               host-neutral adapters
├── protocol/             versioned request, response, and status contract
└── web/                  browser application

dotnet/
├── Hopper.Backend/       transport, dispatcher, operations, status
├── Hopper.Rhino/         plug-in and lifecycle commands
├── Hopper.Grasshopper/   optional compatibility GHA
└── Hopper.Tests/
```

The projects must own the source files under their directories. Remove parent-folder compile globs. Rename `rhino_zmq_poc`, `GHZMQ`, and other proof-of-concept identities in new code. Preserve the old component GUID and a thin type shim only if existing Grasshopper files need it. Give that compatibility layer a stated deprecation policy or distribute it separately.

Clean `dist` before every build. Delete stale compiled modules and any source that becomes unreachable after the transport and dispatcher changes.

## Test and release plan

### Unit and contract tests

- All lifecycle state transitions, including concurrent start, stop, and restart calls.
- Node discovery, missing Node, invalid executable, minimum-version boundary, and newer supported versions.
- Runtime status serialization and C#/TypeScript fixture compatibility.
- Authentication and protocol-version rejection.
- Queue capacity, FIFO ordering, cancellation before start, deadline before start, timeout during execution, and shutdown rejection.
- Grasshopper load success, already loaded, failure, no active document, document opened, and document closed.
- Stale profile cleanup with live and dead PID cases.
- Package allowlist and wrong-target native-module detection.

Keep pure .NET unit tests independent of Rhino and Grasshopper assemblies. Put runtime-dependent tests in a separate integration project and document its runner.

### Rhino integration tests

- Start Rhino with Grasshopper unloaded, run `HopperCode`, and verify that Grasshopper remains unloaded.
- Request a Grasshopper tool, verify that the agent starts Grasshopper once, and verify that status changes before the tool runs.
- Run `HopperCode` twice and verify that only one transport and one Node process exist.
- Exercise all four commands in valid and repeated sequences.
- Submit a mutation followed immediately by a query and verify that the query observes it.
- Fill the queue and verify `BUSY` while Rhino remains responsive.
- Close Rhino during active work and verify that the UI does not stall and the child process exits.
- Kill Node and verify degraded state, bounded recovery, and no duplicate child.
- Open, switch, and close Grasshopper documents and verify capability updates.
- Exercise viewport capture and graph-object creation on a real macOS Rhino installation. Replace or isolate Windows-only drawing APIs if either path fails.

### Package matrix

For every supported target, CI must build from a clean checkout, inspect the allowlist, install the Yak, resolve external Node, import ZeroMQ, start HopperCode, and complete one Rhino and one Grasshopper smoke operation.

| Target | Required before release |
| --- | --- |
| macOS arm64 | Build, package inspection, install, Node resolution, Rhino smoke test |
| macOS x64 | Build, package inspection, install, Node resolution, Rhino smoke test |
| Windows x64 | Build, package inspection, install, Node resolution, Rhino smoke test |
| Windows arm64 | Release only after the full toolchain and live Rhino smoke test pass |

## Acceptance criteria

### Commands and lifecycle

- The four `HopperCode*` commands exist and report consistent state.
- Starting twice creates no duplicate socket, profile, or child process.
- Stop and restart are idempotent and serialized.
- Rhino closing does not synchronously wait on HTTP, child exit, queue drain, or NetMQ shutdown.
- Unexpected child exit is visible and recovery is bounded.

### Readiness

- `getRuntimeStatus` distinguishes Rhino, transport, Grasshopper load, active document, dispatcher, and host state.
- `HopperCode` does not initialize or open Grasshopper.
- The agent checks readiness and attempts one lazy `startGrasshopper` call before a Grasshopper tool call.
- Grasshopper tools cannot execute without an active Grasshopper document.
- Rhino tools remain usable when Grasshopper has no document.

### Ordering and responsiveness

- Mutations resolve only after execution completes.
- A query submitted after a mutation observes that mutation.
- Queue overflow and every cancellation or timeout phase have distinct results.
- A burst cannot execute as one unbounded UI callback.
- Only Rhino and Grasshopper object access runs on the UI thread.
- All NetMQ socket operations occur on their one owner thread.

### Packaging

- Node is absent from every Yak and documented as a prerequisite with minimum version `22.19.0`.
- Each artifact contains only its target OS and CPU native dependencies.
- No tests, maps, stale compiled files, development scripts, lockfiles, workspace files, or wrong-target binaries ship.
- CI enforces the allowlist and per-target size budget.

### Structure and quality

- C# projects own their source trees and no longer compile parent-directory globs.
- Host, extension, protocol, web, and compatibility responsibilities are separated.
- Both sides of the wire contract pass the same fixtures.
- Pure tests run without a local Grasshopper installation.
- The supported macOS and Windows packages pass live Rhino smoke tests.

## Recommended implementation order

1. Land the state model, protocol schema, fixtures, and lifecycle controller seam.
2. Add the four commands and non-blocking stop behavior.
3. Move NetMQ to one owner thread.
4. Land the bounded dispatcher and correlated completion protocol.
5. Add runtime status, agent-triggered Grasshopper startup, and capability gates.
6. Add host recovery and stale-state cleanup.
7. Remove bundled Node and add prerequisite resolution and documentation.
8. Build the target-specific release pipeline and package checks.
9. Move the source trees and remove obsolete names and dead code.
10. Run the full target package and live Rhino test matrix before marking the PR production-ready.

Keep these changes in reviewable commits or small PRs. The protocol and lifecycle work should land before packaging and folder moves, otherwise large mechanical diffs will hide the concurrency changes that need the closest review.
