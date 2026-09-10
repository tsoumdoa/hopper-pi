# Shared host architecture

The shared host runs outside Rhino and owns conversations, model sessions, task scheduling, and recovery records. Rhino and Grasshopper supply native operations through authenticated lifecycle attachments. See [operation and storage details](shared-host-implementation-status.md), [native operation policies](shared-host-native-operation-audit.md), and [platform acceptance evidence](shared-host-platform-probes.md).

## Ownership and scheduling

Each message captures its selected document and accessible targets. Its root task can edit the selected document directly and delegate to other allowed documents. Child tasks use separate Pi sessions and inherit only their assignment and selected attachments. A child cannot expand document or launch authority.

Model calls run concurrently, including for documents in the same Rhino process. Native tool calls and managed document actions share one queue per process. A native call validates its captured attachment, activates the target, executes its edit, and closes and verifies its transaction before releasing the process. No process lease is held between tools. Tool policy is checked before leasing and again before activation and transport dispatch; transaction cleanup can finish after a tool is disabled.

Workers waiting for children release their model slot. Cancellation prevents queued work from starting. Unknown native outcomes or unconfirmed cleanup keep the process fenced until recovery. A timeout alone does not permit another edit. Humans can still change the model, so native document/state validation remains necessary while a task owns a lease.

## Persistence and browser reconnects

SQLite records accepted commands, task/turn identities, dependencies, questions, inputs, operations, grants, and outcomes. Persist intent before model or native dispatch. Repeated commands use the original request ID and cannot execute twice. A possibly started turn is never automatically replayed after host restart.

The browser authenticates before receiving a snapshot or issuing commands. Reload and relaunch restore the last selected conversation. If that browser selection is unavailable, startup selects the latest active root task's conversation, then the latest task's conversation, then the latest empty conversation. It creates a conversation only when none exists or the user chooses New chat. Reconnects preserve the current selection and pending command IDs. Replacing a browser controller does not cancel tasks.

Browser snapshots preserve the transcript, while scheduling and admission reads omit events. Delegation returns completed messages, task status, artifact metadata, and attributed images without copying streaming events into the coordinator's model context. Raw events remain in the journal and export.

## Questions and document changes

A question must be journaled before the tool returns. The Pi suspension boundary blocks remaining tools and another model call. The scheduler resolves native effects and cleanup before exposing the question as answerable. The first valid answer creates one fresh continuation; the old tool result and execution owner remain unchanged. See [Pi suspension behavior](shared-host-pi-suspension-prototype.md).

New/Open actions require a root-task grant with a bounded target, explicit save/discard/refuse policy, verified destinations, and a resulting document binding. The continuation starts after the action and cleanup succeed. Save paths are reserved and checked for changes and cross-process aliases. Geometry transfer publishes immutable checked artifacts, converts units explicitly, and imports with new object identities and provenance.

## Process launch and recovery

A root user's explicit launch request creates a single-use, count-bounded grant. Only installations with matching packaged bootstrap evidence are eligible. Private bootstrap tickets, PID/start identity, attachment generation, and document readiness correlate the launched process. The model cannot supply executable paths or startup commands. Mac supports one Rhino process and uses document creation for additional targets; Windows uses a separate process adapter.

Cancelled or timed-out launches reconcile late evidence without spawning again. Task recovery requires an inspection acknowledgement plus fenced, idle native scopes and operations, or confirmed exit of the original process. Launch recovery additionally requires no in-flight spawn or live candidate and an empty Rhino process list. Recovery permits fresh work while preserving the original uncertain outcome.

## Coverage to retain

Keep behavioral tests for request deduplication, reload/relaunch, immutable target selection, real RuntimeRpc interleaving, independent-process progress, single-worker delegation, question persistence, cancellation, uncertain cleanup, launch correlation/no-respawn, destination checks, and recovery. Adapter tests do not establish packaged Windows or live Rhino behavior. Remaining platform checks are recorded separately in the acceptance evidence.
