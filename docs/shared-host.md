# Shared host architecture

The shared host runs outside Rhino and owns conversations, model sessions, task scheduling, and recovery records. Rhino and Grasshopper supply native operations through authenticated lifecycle attachments.

The first HopperCode launch starts a detached Node host. That Rhino process does not own the host: closing it leaves the same host and browser connection serving the remaining Rhino processes. There is no leader election. After the last registered Rhino process exits, an independent one-second poll starts shutdown. Cleanup has a five-second deadline, after which Node exits even if a task or refresh is stuck. There is no post-exit grace period. Browser closure, document closure, and transport loss do not trigger shutdown while a registered Rhino process remains alive. An initial launch has sixty seconds to register. A subsequent HopperCode launch starts a new host; if the old host is still draining, it waits for the endpoint to close first.

The Web UI opens as soon as the shared HTTP server is available. It shows a loading state while the AI runtime initializes and Rhino registers. The launcher does not load the AI runtime; the detached host imports it after binding HTTP. Browser availability is separate from authenticated native readiness. An early browser waits for its launching Rhino before restoring or creating a conversation, and subsequent registration notifications do not open duplicate tabs.

## Ownership and scheduling

Each message captures its selected document and accessible targets. Its root task can edit the selected document directly and delegate to other allowed documents. Child tasks use separate Pi sessions and inherit only their assignment and selected attachments. A child cannot expand document access.

Model calls run concurrently, including for documents in the same Rhino process. Native tool calls and managed document actions share one queue per process. A native call validates its captured attachment, activates the target, executes its edit, and closes and verifies its transaction before releasing the process. No process lease is held between tools. Tool policy is checked before leasing and again before activation and transport dispatch; transaction cleanup can finish after a tool is disabled.

Workers waiting for children release their model slot. Cancellation prevents queued work from starting. Unknown native outcomes or unconfirmed cleanup keep the process fenced until recovery. A timeout alone does not permit another edit. Humans can still change the model, so native document/state validation remains necessary while a task owns a lease.

## Persistence and browser reconnects

SQLite records accepted commands, task/turn identities, dependencies, questions, inputs, operations, document action receipts, and outcomes. Persist intent before model or native dispatch. Repeated commands use the original request ID and cannot execute twice. A possibly started turn is never automatically replayed after host restart.

The browser authenticates before receiving a snapshot or issuing commands. Rhino processes with overlapping HopperCode connections share one conversation session. Opening HopperCode in another document or process, reloading the browser, or reconnecting restores the current thread while any previously connected Rhino process remains alive. Transport loss does not end the session. A host restart starts a fresh conversation session, even when the same Rhino processes reconnect.

Each host starts with a new conversation session ID and the last prior conversation sequence as its boundary. It replaces session IDs loaded from persisted native attachments. If all prior Rhino processes exit and a new one registers before host shutdown, that registration also starts a new conversation session. Startup restores only conversations after that boundary, so old browser storage cannot reopen a thread from the previous session. Existing tabs switch to the new session as well. Older conversations remain stored. New chat still explicitly creates a conversation within the current session. Replacing a browser controller does not cancel tasks.

Browser snapshots preserve the transcript, while scheduling and admission reads omit events. Delegation returns completed messages, task status, artifact metadata, and attributed images without copying streaming events into the coordinator's model context. Raw events remain in the journal and export.

## Questions and document changes

A question must be journaled before the tool returns. The Pi suspension boundary blocks remaining tools and another model call. The scheduler resolves native effects and cleanup before exposing the question as answerable. The first valid answer creates one fresh continuation; the old tool result and execution owner remain unchanged. See [Pi question suspension](#pi-question-suspension).

The root agent calls `rh_document` or `gh_document` with `action: "new"` or `action: "open"`. The host derives task identity and defaults to the captured process; an explicit `lifecycleInstanceId` must belong to an accessible target. A host-only root can choose among its accessible processes. The host inspects active/replaced documents under the process queue and preserves unsaved changes by default. No browser authorization payload or pre-issued grant is required. The continuation starts on the verified resulting document after cleanup. A known failure returns to the agent on its prior target so it can ask about save/discard; uncertain outcomes remain fenced. Save paths are reserved and checked for changes and cross-process aliases. Geometry transfer publishes immutable checked artifacts, converts units explicitly, and imports with new object identities and provenance.

## Process startup and recovery

Users open the first Rhino and run `HopperCode`. On Windows, a root task can call `launchRhino` with a stable request ID and an optional accessible source lifecycle. The host resolves the source process's executable and precise start identity, persists launch intent, and spawns that installation with structured `/nosplash`, `/notemplate`, and `/runscript=_HopperCode` arguments. The ordinary authenticated registration must match the new PID/start identity and expose one ready initialized Rhino document before the journal atomically grants delegation access. The coordinator's captured document is unchanged. On Mac, additional documents continue to use same-process `new`.

No `HopperBootstrap` command or bootstrap ticket protocol is used. The child-only `HOPPER_RHINO_WORKER=1` environment flag is consumed on initial native startup to suppress a competing browser tab; it is cleared before Node starts, and later manual `HopperCode` opens normally. Launch waiting holds no native edit lease. Duplicate calls share the same in-flight promise, completed calls return the verified binding, and uncertain calls only inspect the original process. An unresolved request blocks replacement requests within the task. Startup failures, cancellation, and timeouts remain in the journal; cancellation does not terminate Rhino. Host restart does not replay launch dispatch.

Task recovery requires an inspection acknowledgement plus fenced, idle native scopes and operations, or confirmed exit of the original process. Recovery permits fresh work while preserving the original uncertain outcome. Historical launch records remain readable but have no dispatcher. Legacy pending authorization submissions fail with an instruction to resubmit. Existing internal journal and wire `grantId` fields remain compatible dispatch receipts; the host creates them from the tool call, and agents never supply them.

## Start and reconnect

Build and install the host and native plugins with the repository's normal package workflow. Open Rhino and run `HopperCode`. The short-lived `--ensure-host` launcher attaches to the existing per-user host or starts one detached host. For direct development startup, use `node dist/host/index.js --ensure-host --explicit-start`.

Closing the browser leaves the host running while a HopperCode-enabled Rhino process remains alive. Closing one Rhino leaves the host serving the others. The last Rhino exiting triggers shutdown on the next one-second lifetime poll, with at most five seconds for cleanup. Within the same host, reloading the browser or opening HopperCode in another document or Rhino instance restores the selected conversation, including running tasks and pending questions. Each new host starts a fresh conversation session, including when existing Rhino processes reconnect after a host restart. Old threads remain stored but do not reopen automatically. If the browser has no saved selection, the journal supplies the latest active or previous thread from the current session. New chat explicitly creates a conversation. Stopping or restarting the host preserves history, but possibly started work becomes interrupted or uncertain and is not automatically replayed.

Chats with unresolved task recovery remain accessible across host restarts. Use the review link to open the affected chat, inspect the model and saved files, and select "I've checked, continue". Recovery tasks remain visible even outside the current history page. "Back to chat" returns to the conversation you were using.

Concurrent native startup waits for the matching shared endpoint. Explicit HopperCode commands open the browser; background reattachments do not open replacement tabs. The browser retries durable commands with their original IDs and captured targets, bounds authentication and silent connection loss, and ignores stale socket events. Replaced tabs require explicit reconnection.

The composer selects one Rhino document or Grasshopper canvas, with access to all instances or only the selected instance. A disconnected selection stays unavailable instead of silently switching models. A conversation can also start without a native target. Diagnostic fixtures remain in journal/export but are excluded from normal chat.

## Storage and limits

Control state lives in `~/.hopper/shared-control`, independently of `--data-dir`. It pins the endpoint, canonical data directory, and SQLite identity. Conflicting data directories, missing journals, incompatible owners, or occupied unhealthy endpoints block startup. Browser credentials stay in the private control directory and URL fragment, outside ordinary logs. Stop host records stopped intent; restarting requires an explicit start.

The SQLite journal uses foreign keys and FULL synchronous commits. Storage schema v5 is separate from shared discovery compatibility v2. Newer storage schemas are rejected. Legacy per-instance histories remain on disk and are not automatically imported. Pi histories live below `sessions/<conversation>/sessions/<session>` and workspaces below `workspaces/<task>`. Task inputs, images, events, operation evidence, grants, and artifacts are retained without automatic pruning.

The defaults allow four bound workers and four ownerless coordinators. `HOPPER_SHARED_MAX_WORKERS` and `HOPPER_SHARED_MAX_COORDINATORS` accept positive integer overrides. Waiting parents release their worker slot. A process queue serializes native tools and managed actions while agents continue model work concurrently.

`HOPPER_SHARED_MAX_TOKENS` defaults to 1,000,000 recorded tokens per root request, including its continuations and delegated tasks. Admission and delegation stop at that total; already-running provider responses can exceed it. Earlier requests do not consume a new request’s budget. Changing the limit requires a host restart. Workers share the host's tool settings profile, and tool changes preserve their task instructions.

## Dispatch and attachment checks

An authenticated handshake includes the host epoch. The native lifecycle validates the epoch and PID against current private discovery, binds the actual DEALER route and issues an attachment generation. Repeated handshakes from the same epoch and route retain the generation. Reattachment retires the old route/epoch, fences its queued requests and queues recovery ahead of ordinary UI work. Running native work finishes before the UI queue reaches recovery. RPC servicing stays available during that work.

Both admission and the UI queue head verify the route, lifecycle, generation and operation binding. The queue head checks captured native document identities. Process transaction scopes retain task, turn, binding and attachment identity. A different owner cannot use or close either scope. Begin reserves ownership before native invocation, so a partially failed begin cannot admit a different task.

Recovery receives the recorded owners for both scopes. An active native scope with missing or conflicting document ownership blocks recovery. Confirmed cleanup clears both bookkeeping scopes and document transaction status. Failed cleanup leaves geometry admission blocked. Recovery does not assert that closing a Rhino undo record rolled back an edit.

Scope completion is the one document-focus exception. It requires the exact owner that opened the scope and calls the native bound-document completion routines. This permits cleanup after focus or association changes without routing a new edit to the current document.

## Exposed operation requirements

| Operations | Native requirement |
| --- | --- |
| `lifecycleHandshake`, `getRuntimeStatus`, `getOperationResult`, `cancelOperation`, `startGrasshopper`, `listAllComponents`, `listRhinoDocuments`, `listGrasshopperDocuments`, `browseDocumentFiles` | Current authenticated lifecycle route. These inspect lifecycle metadata, recover retained results or use the explicit lifecycle controls. They do not acquire a document binding implicitly. |
| `getDocumentTransactionState` | Current authenticated route permits ownerless recovery reads of both scope kinds. An owner-bearing read may inspect only its selected kind or captured associated Rhino kind. |
| `getRhinoDocument`, `getRhinoDocumentSettings`, `queryRhinoObjects`, `captureRhinoView`, `controlRhinoView`, `runRhinoScript`, `beginRhinoAgentTransaction`, `exportRhinoArtifact`, `importRhinoArtifact` | Captured Rhino identity must still equal the native active document. A Grasshopper binding may authorize its explicitly captured associated Rhino identity. Conflicting `documentId`, `expectedDocument` or lifecycle arguments fail. |
| `getGrasshopperDocument`, `getCurrentCanvas`, `getCanvasErrors`, `listScriptParams`, `getScriptCode` | Captured canvas identity and association must still match. If a Rhino association was captured, it must still be the active Rhino context. |
| `getGrasshopperDocumentSettings`, `getParamRhinoGeometry`, `setParamRhinoGeometry` | Captured Grasshopper and Rhino pair, unchanged association, matching active canvas and active Rhino context. |
| `applyGraph`, component/wire/group edits, slider/panel/toggle/swatch/scribble/value-list edits, script-node/parameter edits, `beginAgentTransaction` | Same captured canvas and association checks. Mutations without an associated Rhino document remain unavailable because Grasshopper evaluation may read active Rhino settings. |
| `commitAgentTransaction`, `cancelAgentTransaction`, `commitRhinoAgentTransaction`, `cancelRhinoAgentTransaction` | Exact recorded scope owner. Completion uses the document reference retained when opening the scope, even after focus changes. |
| `manageRhinoDocument`, `manageGrasshopperDocument` | New/open require separate `documentActionOwner`, current lifecycle/generation, both scopes closed, recovery complete, and at most one wire operation ID per internal action receipt. Bound save/saveAs/close accept the captured execution owner, enforce document identity/state tokens, close only that owner’s recorded segment, and require the other native scope idle. Captured activation requires both scopes idle, observed current active identity and target state token, validates the requested document against the owner, and verifies the active target afterward. Host-reserved canonical destinations, content digests, and native transition preconditions protect managed writes. |

All component, wire, group, value and script operations retain the current executor routing through the native active canvas. The shared guard checks that canvas immediately before invocation instead of switching to another canvas. On Mac, New/Open creates another document window in the same process. A new window remains under the same process queue; it does not provide concurrent native editing.

Before starting geometry or transferring an artifact, the host can activate the captured document under its process lease after confirming both native scopes idle. It records the activation intent, supplies observed state/current-focus tokens, and verifies the selected context afterward. Later active-document drift fails at native dispatch. Switching browser selection cannot change a running owner.

Transaction replies and scope queries include `scopeOwner` and `recoveryRequired` from the native execution fence. A failed begin can retain ownership while the document segment is idle. The host keeps cleanup responsibility until it reconciles ownership and completes any owned cleanup under the same process lease. Cleanup requires an idle segment, no fence owner, and no native recovery requirement. A rejected `EndUndoRecord` retains the Rhino transaction for recovery. Debug exports include cleanup observations and undo-state diagnostics on failed begins.

An explicit native activation rejection is recorded as failed, with its original result and reason. An unknown outcome remains uncertain. Unconfirmed scope cleanup independently blocks the process against the task that owned the scope.

## Script and transfer limits

Rhino scripts receive the validated active Rhino document as their default context. Grasshopper scripts execute in the validated canvas and associated Rhino context. These are trusted in-process programs; they can access other documents and external files through native APIs. RPC binding and managed-save reservations do not sandbox arbitrary script side effects.

Export supports unmaterialed points, point clouds, curves, surfaces, breps, extrusions and meshes. Instances, annotation/font dependencies, lights, plugin geometry and assigned materials fail before export. Export writes a new `.3dm` staging file and never changes the source document save path. The manifest data includes units, absolute tolerance, supported object types, selected source identities, byte length and creation time.

The packaged Mac fixture exposed a RhinoCommon collection bug: `File3dmObjectTable.Count` reported one object while LINQ `ToArray()` returned a null entry. Import now enumerates the native table explicitly and rejects missing geometry or attributes before mutation.

Import hashes the actual byte buffer passed to `File3dm.FromByteArray`, checks source units and destination settings revision, and validates all geometry before changing the destination. Standard units must use the native physical conversion factor. Unknown/custom units need an explicitly supplied factor. Import requires the owner's Rhino scope, creates a unique transfer layer namespace and new destination object identities, and returns source/destination provenance. A partial add reports the IDs already added rather than claiming atomic rollback. Native round-trip fidelity is not established by compiling this adapter.

## Pi question suspension

The shared task driver uses `src/host/question-suspension.ts` to stop the Pi model/tool loop at a durable user question. Its integration test exercises the installed Pi SDK directly.

Install the boundary on `session.agent` after AgentSession construction and before prompting. It preserves the existing tool authorization hook, selects sequential tool execution, blocks remaining calls after a question, and uses `shouldStopAfterTurn` to end the run. The task's question tool calls `suspend` with its stable question, task, session, turn, and Pi tool-call identities. An injected persistence function must commit the question before the tool returns `awaiting_user`. A failed commit still stops dispatch and leaves an error tool result. The scheduler must interpret that failure and retain ownership until it has resolved cleanup.

The SDK's blocked-tool path produces an error result for every remaining valid sibling call. Unknown tools or invalid arguments also produce error results without dispatch. The stop hook prevents the next provider request even if earlier successful edits mean the whole tool batch did not terminate. `abort()` alone is unsuitable for this protocol: the SDK sequential loop breaks after an aborted call and can leave later calls without tool-result messages. Returning `terminate: true` from the question alone is also insufficient: the SDK terminates a batch only when every result requests termination, and does not use that flag to skip siblings.

The shared scheduler and journal implement question/answer transactions, native-operation settlement, cleanup, cancellation, crash recovery, and answer-linked turn deduplication. This SDK-level test isolates dispatch and history behavior. The shared driver and task-service tests cover durable admission and continuation.

Do not enable answers or release a Rhino process merely because Pi stopped. Resolve actual native effects and close the owned scopes first. A question commit alone does not establish an answerable question. During recovery, reconstruct question state from the journal and reconcile history without rewriting the old tool result as an answer.

One boundary belongs to one execution. Remove it only after Pi settles, and install a new boundary before a newly admitted execution. The scheduler must keep ownership of these hooks and sequential execution mode throughout the run. No extension may replace them. Pending Pi steering/follow-up queues remain in memory when the stop hook ends a run; shared mode must use journaled admission and explicitly settle or clear old queues before starting another execution. The shared driver settles or clears those queues before a continuation.

## Native validation

Validate each packaged build on macOS and Windows. Remaining checks include Windows ACLs, detached lifetime and native transfer, sleep/wake, and the full crash matrix. Unit tests and injected adapters do not establish packaged Rhino behavior. Keep dated results and build identities in the PR validation record.
