# Shared host operation and status

The shared host is the normal HopperCode runtime. It supports persistent conversations, multiple Rhino documents and processes, delegated agents, direct document create/open tools and geometry transfer. [Architecture and invariants](shared-host-multi-rhino-plan.md) describe the ownership and recovery rules.

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

## Native acceptance and remaining checks

The historical packaged Mac fixture passed first-process bootstrap, New in one process, captured activation, a 1000 mm to 1 m geometry transfer with new identities and provenance, and managed saves. Separate checks verified host survival after Rhino exits. See [platform probes](shared-host-platform-probes.md) for exact build identities and results, and [the operation audit](shared-host-native-operation-audit.md) for native routing and cleanup policies.

Windows root agents can launch additional Rhino instances through `launchRhino`, reusing ordinary `HopperCode` registration without `HopperBootstrap`. Open the first Rhino manually and run `HopperCode`; use `rh_document` or `gh_document` to create/open files without a separate grant. Windows ACLs, detached lifetime, and native transfer still require a Windows packaged acceptance run. Native sleep/wake and the full crash matrix remain acceptance work. Unit tests and injected adapters do not satisfy these checks. Historical packaged results do not establish behavior for newer host/plugin builds.

Current build and test results belong in the PR validation record. Run `pnpm build`, the Vitest suite, and the relevant native tests before updating that record.
