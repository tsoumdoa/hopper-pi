# Shared host architecture

The shared host runs outside Rhino and owns conversations, model sessions, task scheduling, and recovery records. Rhino and Grasshopper supply native operations through authenticated lifecycle attachments. See [operation and storage details](shared-host-implementation-status.md), [native operation policies](shared-host-native-operation-audit.md), and [platform acceptance evidence](shared-host-platform-probes.md).

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

A question must be journaled before the tool returns. The Pi suspension boundary blocks remaining tools and another model call. The scheduler resolves native effects and cleanup before exposing the question as answerable. The first valid answer creates one fresh continuation; the old tool result and execution owner remain unchanged. See [Pi suspension behavior](shared-host-pi-suspension-prototype.md).

The root agent calls `rh_document` or `gh_document` with `action: "new"` or `action: "open"`. The host derives task identity and defaults to the captured process; an explicit `lifecycleInstanceId` must belong to an accessible target. A host-only root can choose among its accessible processes. The host inspects active/replaced documents under the process queue and preserves unsaved changes by default. No browser authorization payload or pre-issued grant is required. The continuation starts on the verified resulting document after cleanup. A known failure returns to the agent on its prior target so it can ask about save/discard; uncertain outcomes remain fenced. Save paths are reserved and checked for changes and cross-process aliases. Geometry transfer publishes immutable checked artifacts, converts units explicitly, and imports with new object identities and provenance.

## Process startup and recovery

Users open the first Rhino and run `HopperCode`. On Windows, a root task can call `launchRhino` with a stable request ID and an optional accessible source lifecycle. The host resolves the source process's executable and precise start identity, persists launch intent, and spawns that installation with structured `/nosplash`, `/notemplate`, and `/runscript=_HopperCode` arguments. The ordinary authenticated registration must match the new PID/start identity and expose one ready initialized Rhino document before the journal atomically grants delegation access. The coordinator's captured document is unchanged. On Mac, additional documents continue to use same-process `new`.

No `HopperBootstrap` command or bootstrap ticket protocol is used. The child-only `HOPPER_RHINO_WORKER=1` environment flag is consumed on initial native startup to suppress a competing browser tab; it is cleared before Node starts, and later manual `HopperCode` opens normally. Launch waiting holds no native edit lease. Duplicate calls share the same in-flight promise, completed calls return the verified binding, and uncertain calls only inspect the original process. An unresolved request blocks replacement requests within the task. Startup failures, cancellation, and timeouts remain in the journal; cancellation does not terminate Rhino. Host restart does not replay launch dispatch.

Task recovery requires an inspection acknowledgement plus fenced, idle native scopes and operations, or confirmed exit of the original process. Recovery permits fresh work while preserving the original uncertain outcome. Historical launch records remain readable but have no dispatcher. Legacy pending authorization submissions fail with an instruction to resubmit. Existing internal journal and wire `grantId` fields remain compatible dispatch receipts; the host creates them from the tool call, and agents never supply them.

## Coverage to retain

Keep behavioral tests for request deduplication, reload/relaunch, immutable target selection, real RuntimeRpc interleaving, independent-process progress, single-worker delegation, question persistence, cancellation, uncertain cleanup, direct create/open handoff, destination checks, and recovery. Adapter tests do not establish packaged Windows or live Rhino behavior. Remaining platform checks are recorded separately in the acceptance evidence.
