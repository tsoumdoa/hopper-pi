# Self-host Pi Rhino fix plan

This plan covers the smallest reliable version of the Rhino-owned HopperCode host. It fixes lifecycle, thread ownership, operation completion, Grasshopper readiness, and release packaging. It does not combine those fixes with a broad source-tree cleanup.

## Scope

The work must:

- Make `HopperCode`, stop, status, restart, and Rhino exit predictable.
- Keep NetMQ ownership and process waits off Rhino's UI thread.
- Run Rhino and Grasshopper work through one ordered, bounded dispatcher.
- Resolve mutations only after the UI operation completes.
- Load Grasshopper only when an agent requests a Grasshopper tool.
- Require external Node `22.19.0` or newer.
- Produce clean macOS arm64 and Windows x64 packages.

This version deliberately leaves out:

- Automatic Node restart and recovery backoff. A dead or unhealthy child moves the lifecycle to `faulted`; the user runs `HopperCodeRestart`.
- Windows arm64 and macOS x64 packages.
- A general TypeScript folder reorganization.
- Unrelated namespace and proof-of-concept renames.
- Exact-once recovery across a Node process crash.
- A checked-in hash for every file in `node_modules`.
- CI changes.

## Preserve public identity

Renames and project moves must preserve all existing public identifiers:

| Identity | Frozen value |
| --- | --- |
| `Hopper` command, renamed to `HopperCode` | `f4e34020-8f9a-4cc4-98ed-5b3596163859` |
| `HopperStatus` command, renamed to `HopperCodeStatus` | `db50ad24-52d8-4e58-ae8a-5719994ad577` |
| New `HopperCodeStop` command | `c26698e7-9893-4960-b158-f973cac41744` |
| New `HopperCodeRestart` command | `af29e70b-389e-4430-bdda-ac40c33d0ab5` |
| Rhino plug-in | `4c3eae5e-7e91-4d5c-9bbf-d95e981c5de9` |
| Legacy Grasshopper component | `e07753b1-fdec-417a-b57a-83a95204a8dd` |
| Grasshopper assembly info | `a41e7f39-12f0-4cc2-9f84-fd3d6bf3eaef` |

Do not keep a `Hopper` command alias.

Update every user-facing `_Hopper` and `_HopperStatus` reference in the browser, README, installers, scripts, and diagnostics. The new command names are `_HopperCode` and `_HopperCodeStatus` when written as scripted Rhino commands.

## C# project boundary

Use three production projects:

```text
dotnet/
├── Hopper.Core/
├── Hopper.Rhino/
└── Hopper.Grasshopper/
```

`Hopper.Core` contains:

- Protocol DTOs and validation.
- Lifecycle policy.
- The ROUTER and PUB transport owner.
- Dispatcher and result-store policy.
- Interfaces for time, process control, UI scheduling, and Grasshopper capability.

It may reference NetMQ. It must not reference RhinoCommon or Grasshopper.

`Hopper.Rhino` contains the RHP, commands, host process manager, Rhino operations, Rhino document tracking, and implementations of the Core interfaces. It references RhinoCommon and Core, but not Grasshopper.

`Hopper.Grasshopper` contains the lazy Grasshopper adapter, Grasshopper operations, document tracking, and the existing compatibility component. The compatibility component keeps its saved-file identity and does not start HopperCode, the transport, or Node.

Core defines the Grasshopper capability and adapter-registration interfaces. `Hopper.Grasshopper` registers one adapter from an assembly-load hook and unregisters that same adapter when it unloads. Registration is compare-and-set: a second adapter cannot replace a live one. The adapter owns Grasshopper operations and event subscriptions. Registration may move status from `loading` to `ready`; initialization or registration failure moves it to `failed`. The Rhino project observes only the Core interface and immutable status, so it never loads a Grasshopper type.

Each project owns the source files below its directory. Remove parent-folder compile globs. Do not move unrelated TypeScript files as part of this work.

## Lifecycle

Rhino owns one lifecycle controller. Independent components do not keep competing `isRunning`, `isStopping`, or recovery flags.

The top-level states are:

```text
stopped -> starting -> running -> stopping -> stopped
                \-> faulted
running -> faulted
faulted -> starting
```

Every transition records `changedAt`, a typed reason code, and a message.

### State transitions

| Current state | Trigger | Next state | Action |
| --- | --- | --- | --- |
| `stopped` | Start or restart | `starting` | Resolve Node, bind transport, write the instance profile, launch Node, and wait for its authenticated transport handshake. |
| `starting` | Handshake succeeds | `running` | Publish the ready snapshot and open the browser. |
| `starting` | Node resolution, bind, launch, or handshake fails | `faulted` | Clean up partial startup and record the failure. Do not retry automatically. |
| `running` | Child exits or reaches the health-failure threshold | `faulted` | Reject new host work, clean up agent transactions, and stop the failed child if it still exists. |
| Any state except `stopped` | Stop | `stopping` | Reject new work and start background cleanup. |
| `stopping` | Cleanup succeeds | `stopped` | Clear live instance state and report completion in Rhino. |
| `stopping` | Child or transport does not stop within its deadline | `faulted` | Record `CHILD_STILL_ALIVE` or `TRANSPORT_STOP_TIMEOUT`. Do not start a replacement. |
| `faulted` | Start or restart | `starting` | Verify that the old child and transport are gone, then start. |

`running` means the Rhino transport is ready and Node completed an authenticated protocol round trip for the current lifecycle instance. A plain HTTP 200 response is not enough.

Transient HTTP health failures remain in the host status. Three consecutive failures move the lifecycle from `running` to `faulted`. There is no `degraded` or `recovering` state in this version.

### Command behavior

| Command | Behavior |
| --- | --- |
| `HopperCode` | Start from `stopped` or `faulted`. In every other state, print the current state and do not launch another process or transport. |
| `HopperCodeStop` | Enter `stopping` and return `stop accepted` without waiting on the UI thread. Repeated calls return the current state. |
| `HopperCodeStatus` | Print lifecycle, host, transport, Rhino document, Grasshopper, dispatcher, Node path and version, and the latest error. It never starts anything. |
| `HopperCodeRestart` | From `stopped`, act as start. Otherwise serialize stop and start. During `stopping`, queue one start after cleanup. Coalesce repeated restart requests. |

The controller serializes commands through one asynchronous gate. Completion of stop, restart, and background failure cleanup writes one short message to the Rhino command line through the UI dispatcher.

## Startup, health, and shutdown

### Node startup order

1. Resolve and validate the Node executable.
2. Start the transport owner and bind all sockets.
3. Write the instance-specific connection profile.
4. Launch Node with that profile and the Rhino parent PID.
5. Let Node connect its DEALER socket and complete an authenticated protocol handshake.
6. Mark the lifecycle `running` and open the browser.

Any failure unwinds only resources created by that start attempt.

Node's ready message and `/health` response must include the current lifecycle instance and whether the Rhino protocol handshake is live. Rhino rejects a ready or health response for another instance.

### Controlled stop

`HopperCodeStop` and the stop half of restart perform this work off the UI thread:

1. Enter `stopping`, reject new external RPC work, and cancel queued external work.
2. Schedule transaction cleanup through the dispatcher's reserved internal control path on Rhino's UI thread.
3. Ask Node to shut down and allow up to three seconds.
4. Kill the verified child process tree if it remains alive.
5. Wait up to one second for the killed child to exit.
6. Stop and join the transport owner with a two-second deadline.
7. Delete only the owned instance profile.
8. Enter `stopped` or a typed `faulted` state.

Restart never launches a replacement until the old process handle has exited and the transport released its endpoints.

The dispatcher accepts lifecycle control work after it closes external admission. This reserved internal path is ordered after any operation already running, does not share the external capacity limit, and is limited to transaction cleanup and short command-line completion messages. Controlled stop waits for transaction cleanup before tearing down the transport, subject to its own deadline. The Rhino closing path posts best-effort cleanup but never waits for it.

### Rhino process exit

The Rhino closing event must not wait for HTTP, Node disposal, process exit, queue drain, or NetMQ shutdown.

It must:

1. Reject new work and cancel queued items.
2. Signal the transport owner.
3. Kill the verified Node process tree without waiting.
4. Return from the closing callback.

Do not send a graceful Node shutdown request immediately before killing it.

The Node parent watchdog polls every two seconds. When it detects that Rhino is gone, it exits immediately or uses a force-exit deadline below one second. A child must not survive more than three seconds after abrupt Rhino termination.

### Agent transaction cleanup

Host loss, stop, and restart can interrupt an agent turn after it opened a transaction.

- Cancel an open Grasshopper agent transaction on the UI thread, restoring its saved pre-turn snapshot.
- Close an open Rhino undo record on the UI thread. Rhino operations already applied remain as one undoable record because the current Rhino transaction has no rollback implementation.
- Record cleanup failure in runtime status without blocking process shutdown.

## RPC transport and dispatcher

Use one ROUTER and one PUB socket. A dedicated owner thread creates, binds, polls, unbinds, and disposes both sockets. No socket reference may escape that owner.

Node owns one DEALER client and a pending-request map. Give the DEALER a stable identity for reconnects within the same Node process. Enable mandatory ROUTER delivery so a response to a disconnected client produces an observable error instead of disappearing.

PUB carries advisory status and document events only. RPC replies are the authority for operation completion.

### Request contract

Every request contains:

- `protocolVersion`
- `lifecycleInstanceId`
- `requestId`
- authenticated operation name and arguments
- `startDeadlineAt`, in Unix milliseconds

Mutations also contain an `operationId`. Queries do not.

`startDeadlineAt` is the deadline for dispatcher execution to begin. Node owns the separate completion timeout. Responses echo `requestId` and, for mutations, `operationId`.

The transport rejects invalid authentication, protocol mismatch, stale lifecycle instance, malformed contents, and an expired start deadline before dispatcher admission.

Check in one protocol schema and shared fixtures before replacing either transport endpoint. They define the exact request and response envelopes, authentication field, ROUTER multipart framing, operation classification, result and reason codes, and handshake, cancellation, and `getOperationResult` messages. C# and TypeScript contract tests must read the same fixtures.

### Ordered dispatcher

All Rhino and Grasshopper object access enters one bounded FIFO dispatcher. Immutable runtime status and transport health may bypass it.

Start with a queue capacity of 64 and keep it configurable in tests. Overflow returns `BUSY` with current depth and capacity.

The Rhino UI pump executes one item per callback and reposts if work remains. One operation remains atomic in this version. Record UI duration and warn after 250 milliseconds, but do not claim that a single long operation is time-bounded.

The default start deadline is 30 seconds. Node waits up to 120 seconds for completion unless a tool declares a longer timeout. A caller timeout does not cancel work that already started.

Support these result classes in the shared protocol:

- completed
- failed
- busy
- deadline exceeded before start
- cancelled before start
- capability unavailable
- no active Grasshopper document
- shutting down
- outcome unknown, which is Node-local and never a Rhino terminal result

Keep detailed reason codes in the shared schema rather than duplicating a long enum in this plan.

### Mutation-result recovery

This version does not retry mutations and does not keep a process-lifetime deduplication ledger.

Rhino keeps in-flight mutation state and bounded terminal mutation results so the same Node process can recover a reply lost during socket reconnect:

- Retain terminal mutation results for 10 minutes.
- Retain no more than 256 results or 16 MiB of serialized result bodies.
- Limit each serialized mutation result to 64 KiB. Result producers must summarize or truncate diagnostic output to stay within that bound. Large canvas and document data belongs to queries and is never retained.
- Reserve one 64 KiB result slot before admitting a mutation. If capacity is unavailable after expired entries are removed, return `BUSY`.
- Never evict an in-flight mutation.

`getOperationResult` is an internal protocol request. It returns pending, a terminal result, or not found. The Node tool layer calls it automatically after reconnect and continues until the operation finishes or the tool's completion budget expires. Do not register it as an agent-visible tool.

Cancellation is also internal. A queued operation may become cancelled before start. Once execution begins, cancellation is rejected and Rhino records the real result.

If Node itself crashes, the replacement process does not know the original operation ID. Exact-once recovery across that crash is outside this version. The browser and `HopperCodeStatus` must describe the interrupted turn as having a potentially unknown mutation outcome.

## Runtime status and Grasshopper readiness

Rhino owns an immutable runtime snapshot. NetMQ reads it without calling Rhino or Grasshopper APIs from the transport thread.

The shared status schema contains:

- Protocol version, revision, and observation time.
- Lifecycle state, change time, and latest reason.
- Transport readiness and lifecycle instance ID.
- Host state, PID, Node version, handshake state, and health-failure count.
- Active Rhino document state and name.
- Grasshopper installation, load, readiness, and active-document state.
- Dispatcher acceptance, depth, and capacity.
- The latest error for each component.

Use `not_installed`, `not_loaded`, `loading`, `ready`, and `failed` for Grasshopper state. `ready` includes component-server readiness, so a second boolean cannot disagree with it.

Increment `revision` whenever any status field changes. Rhino document open, close, rename, and active-document events update the Rhino part. Grasshopper canvas and document events update the Grasshopper part on the UI thread.

Node returns Rhino's snapshot unchanged to the agent and browser. Node process details already present in the Rhino snapshot must not be replaced by a second Node-owned status model.

When Node is dead, only `HopperCodeStatus` can show current status. Do not promise that the dead process's browser will report the fault.

### Lazy Grasshopper start

`HopperCode` starts Rhino transport and Node only. Its startup assembly path must contain no static Grasshopper reference.

Before a `gh_*` tool runs, Node:

1. Subscribes to advisory status events.
2. Reads the full runtime snapshot.
3. Calls `startGrasshopper` once if the state is `not_loaded`.
4. Reads status again to close the event-subscription race.
5. Waits up to 60 seconds for `ready`, using events only as wakeups.
6. Re-reads status after reconnect and at the deadline.
7. Checks for an active Grasshopper document before submitting the original tool.

Coalesce simultaneous start requests per lifecycle instance.

`startGrasshopper` schedules the supported `_Grasshopper` command on Rhino's command or UI thread. This can open the Grasshopper editor and may create an untitled document as a command side effect. The browser must tell the user before triggering it. HopperCode itself does not call `AddNewDocument` or select a document.

If Grasshopper is ready without an active document, Rhino tools remain available and Grasshopper tools return `NO_ACTIVE_GRASSHOPPER_DOCUMENT`.

## External Node prerequisite

Use a `NodeRuntimeResolver` with this order:

1. `HOPPER_NODE_EXECUTABLE`, if it is an absolute path.
2. `nodeExecutable` in the Hopper app-data `config.json` file.
3. `node` resolved from the Rhino process environment.
4. Standard installation paths for the current OS.

The macOS standard paths are `/opt/homebrew/bin/node`, `/usr/local/bin/node`, and `/usr/bin/node`. The Windows paths include `%ProgramFiles%\nodejs\node.exe` and `%LocalAppData%\Programs\nodejs\node.exe`.

Do not glob version-manager directories or invoke Node through a shell. Users of nvm, fnm, Volta, asdf, or mise can put the absolute executable path in `config.json`.

Run `node --version` off the UI thread with a three-second timeout. Accept stable versions at or above `22.19.0`. Return typed errors for missing, non-executable, malformed, prerelease, and unsupported versions. Missing or unsupported Node goes directly to `faulted` without retry.

Record the resolved path and version in `HopperCodeStatus`. Documentation must cover Node installation, the config file, version verification, Yak installation, status, and restart on macOS arm64 and Windows x64.

## Release packaging

Support `mac-arm64` and `win-x64`. The packaging script may stage either target on either supported build OS. Native OS and CPU machines are required for final verification, not for TypeScript or AnyCPU compilation.

For each target:

1. Start from an empty staging directory.
2. Clean `dist` and run a release TypeScript build without tests or first-party source maps.
3. Copy only runtime files.
4. Copy `package.json`, the workspace file if installation needs it, and the lockfile into staging.
5. Run `pnpm install --prod --frozen-lockfile` with the requested target OS and CPU configured so target-specific optional dependencies are installed.
6. Remove the lockfile, workspace file, installer-only scripts, `.bin`, tests, maps, stale output, and development files after installation.
7. Keep only the requested native artifacts.
8. Stage the managed .NET release output and remove irrelevant runtime and satellite folders deliberately.
9. Generate the Yak.
10. Run the package verifier.

Remove bundled Node download, checksum, extraction, manifest selection, and executable code. Remove the unused direct `chalk` dependency.

### Package verifier

`scripts/verify-rhino-package.mjs --target <target> <staging-path>` must:

- Apply checked-in path allow rules and deny rules.
- Reject tests, first-party source maps, stale builds, lockfiles, workspace files, development scripts, a Node executable, and known unrelated modules.
- Inspect Mach-O, PE, ELF, `.node`, `.dylib`, `.so`, and `.dll` files.
- Read the PE CLI header before classifying a `.dll` as native. Managed assemblies must not fail a native-target check.
- Reject native files for another OS or CPU.
- Write a sorted manifest with path, byte size, and SHA-256 hash as a release artifact.
- Report staged and Yak sizes.

Do not compare all dependency hashes against a committed `node_modules` manifest. Establish clean macOS arm64 and Windows x64 size baselines first, then set per-target ceilings with a documented margin.

Build success is not release verification. On each native target, install the Yak, resolve external Node, import ZeroMQ, run `HopperCode`, and complete one Rhino and one Grasshopper operation.

## Profiles and retained data

Each instance profile contains owner PID, owner process start time, lifecycle instance ID, creation time, endpoints, and authentication data.

The instance-specific profile is authoritative for the managed Node host. Keep `connection.json` only as a best-effort, last-started compatibility pointer for standalone clients. Document that two Rhino instances can race on this legacy pointer. Do not use it for the managed host.

Delete an instance profile immediately when its owner is verified dead. Delete only when PID and process start time prove ownership. Keep malformed or uninspectable profiles.

Keep user workspace and conversation data indefinitely in this version. Ephemeral instance directories may retain logs for seven days after their owner is verified dead. Never delete an active instance based on age.

## Tests

### Pure tests

Run Core and Node tests without Rhino or Grasshopper installed. Cover:

- Lifecycle transitions and concurrent start, stop, and restart calls.
- Node resolution and version boundaries.
- Protocol fixtures shared by C# and TypeScript.
- ROUTER and DEALER multiplexing, reconnect, mandatory delivery, authentication, and version rejection.
- FIFO ordering, queue capacity, cancellation before start, start deadlines, and shutdown rejection.
- Mutation completion, lost-reply lookup, result TTL, count and byte limits, and query non-retention.
- Status subscription races and dropped advisory events.
- Profile ownership and legacy-pointer behavior.
- Package rules and native-binary classification.

The pure test output must contain neither RhinoCommon nor Grasshopper assemblies.

### Live Rhino tests

Use a controlled Rhino profile with Grasshopper configured for load on demand. Do not inherit a developer's plug-in startup setting.

Automate the supported Windows scenarios where the available Rhino test harness permits it. Treat the macOS Rhino suite as a recorded manual checklist unless a reliable automation harness is added.

The live suite covers:

- `HopperCode` leaves Grasshopper unloaded.
- The loaded assembly list excludes Grasshopper and `Hopper.Grasshopper` after Rhino-only startup.
- A Grasshopper tool starts Grasshopper once and waits for readiness.
- Repeated command sequences create one transport and one child.
- A mutation followed by a query observes the mutation.
- A lost mutation reply is recovered without resubmission.
- Stop and restart clean queued work and open transactions without blocking the UI.
- Abrupt Rhino exit leaves no child after three seconds.
- Node exit or three failed health checks produces a visible `faulted` state.
- Rhino and Grasshopper document events update status.
- The native macOS and Windows packages pass one Rhino and one Grasshopper smoke operation.

## Implementation order

1. Add regression tests for all frozen GUIDs and command names.
2. Create `Hopper.Core`; add the shared protocol schema and fixtures, dispatcher admission policy, Grasshopper adapter-registration contract, and pure tests. Then move ROUTER and PUB ownership and result policy into it.
3. Replace PULL and REP with ROUTER and DEALER. Make all existing operations await correlated completion.
4. Add the five-state lifecycle, external Node resolver, four commands, startup handshake, controlled stop, exit path, and transaction cleanup.
5. Split Grasshopper code into `Hopper.Grasshopper`; add lazy startup, capability checks, and Rhino and Grasshopper document events.
6. Add internal mutation-result lookup and Node reconnect polling.
7. Remove bundled Node and implement cross-target staging and package verification.
8. Run pure tests, controlled live Rhino tests, and both native package smoke tests.

Keep commits small around transport and lifecycle code. Defer unrelated mechanical renames and folder moves until these changes are stable.

## Acceptance criteria

The work is complete when:

- The four commands report one consistent lifecycle and never create duplicate children or transports.
- `running` requires an authenticated Node-to-Rhino protocol handshake.
- Stop and restart do not wait on Rhino's UI thread.
- Abrupt Rhino exit leaves no Node child after three seconds.
- Host loss cleans open Rhino and Grasshopper transactions.
- All NetMQ socket operations occur on one owner thread.
- All document access uses one bounded FIFO UI dispatcher.
- Mutations resolve on completion, and the same Node process can recover a lost reply without resubmitting the mutation.
- Queries are never retained in the mutation-result store.
- `HopperCode` does not load Grasshopper or statically reference it.
- A Grasshopper tool performs one explicit lazy-start flow and requires an active document.
- The status snapshot follows Rhino and Grasshopper document changes.
- Node is absent from every Yak and the resolver enforces `22.19.0`.
- The verifier distinguishes managed DLLs from native binaries and rejects wrong-target native files.
- macOS arm64 and Windows x64 pass their native install and smoke tests.
