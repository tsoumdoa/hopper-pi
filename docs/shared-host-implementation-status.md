# Shared host implementation status

The implementation now covers all eight code milestones in [the plan](shared-host-multi-rhino-plan.md). The shared host is the normal HopperCode runtime. The reusable packaged Mac fixture passed authenticated first-process bootstrap, New in one process, captured activation, a 1000 mm to 1 m geometry transfer with new identities and provenance, and both managed saves. Separate checks verified host survival after Rhino exits. Windows acceptance still requires a Windows Rhino runner. Tests with injected native adapters do not establish Windows runtime behavior.

## Running Hopper

Build and install the host and native plugins with the repository's normal package workflow. Open Rhino normally and run `HopperCode`. The native launcher uses the short-lived `--ensure-host` path to attach to the user's existing host or start one detached host. No environment flag or special Rhino launch command is needed.

For a direct development start, use `node dist/host/index.js --ensure-host --explicit-start`. The native command opens the authenticated application at `/`. Browser credentials remain in the private control directory and the URL fragment, never in the ordinary host log. Closing a browser tab or Rhino does not stop the host. The browser's Stop host action records stopped intent; a later explicit start is required.

Control state lives in `~/.hopper/shared-control`, independently of `--data-dir`. It pins one endpoint, one canonical storage directory, and the SQLite identity. A different data directory, missing journal, incompatible owner, or occupied unhealthy endpoint produces a conflict instead of another host. Shared storage is separate from legacy histories, which are preserved.

## Delivered behavior

| Milestone | Implementation |
| --- | --- |
| 1. Task storage and isolation | Session-owned RPC/alias/turn state, SQLite schema migrations through v5, atomic acceptance and request hashes, operation dispatch evidence, durable steering/questions/answers, timestamps, retained attachments and recovery dispositions. The real Pi SDK suspension test stops a tool batch and resumes from disk history in a fresh turn. |
| 2. Host lifetime | Per-user control locking and endpoint ownership, pinned storage, private persistent browser credential, detached startup, explicit stop revisions, native registration and epoch reattachment, targeted bootstrap tickets. |
| 3. Durable single-target execution | Authenticated browser commands and takeover, snapshot-before-admission reconnects, discussion without Rhino, persisted process scheduling, cancellation and cleanup, explicit inspection-based recovery without replay. |
| 4. Multiple attachments and documents | Dedicated transport per lifecycle, captured Rhino/Grasshopper bindings, native attachment-generation fencing and UI-queue validation, same-process serialization, independent process progress, bounded inventory refresh, destination reservations and save baseline checks. |
| 5. Document transitions | Exact root-task New/Open grants, explicit refuse/save/discard handling, scope cleanup before a document action, verified resulting binding, and one fresh continuation. Workers cannot expand document authority. |
| 6. Delegation | Independent child sessions, durable assignments/dependencies, attributed messages/questions/results, root cancellation, usage accounting and bounded coordinator/worker admission. Coordinators collect child results before summarizing. |
| 7. Rhino launch | Persisted count-bounded launch grants, installation/build capability checks, opaque single-use bootstrap tickets, PID/start correlation, readiness verification, cancellation/timeout reconciliation without respawn. Mac permits one process and creates additional targets with Rhino New. Windows has a separate process adapter. |
| 8. Geometry transfer | Native selected-object `.3dm` export, immutable artifact/checksum publication, supported-object validation, units and tolerance metadata, scaled import with new identities and provenance, source-save-path preservation, sequential ownership for two Mac documents. |

The normal browser UI provides conversations, process/document selection, task and child history, steering, questions, recovery acknowledgements, bounded document and launch controls, model selection and authentication. Task execution continues without a connected browser. A replacement tab takes control without cancelling tasks.

## Limits and storage rules

The host admits at most four bound workers and four ownerless coordinators by default. Coordinators have a separate limit so waiting for children cannot consume the workers' entire capacity. `HOPPER_SHARED_MAX_WORKERS` and `HOPPER_SHARED_MAX_COORDINATORS` accept positive integer overrides. Process ownership imposes an additional limit of one editing task or document action per Rhino process.

`HOPPER_SHARED_MAX_TOKENS` defaults to 1,000,000 recorded tokens across the pinned journal. Admission and new delegation stop once that total is reached. This is an admission budget, not a hard bound on an already-running provider response; concurrent responses can finish beyond it. Raising the configured value requires an explicit host restart. Launch grants never increase these limits. Per-turn usage counts each session once. Admin configuration writes are serialized; the shipped Pi credential store also locks refresh writes to the shared auth file.

Submission text and image attachments are immutable JSON in SQLite and retained with task history. Semantic messages, steering receipts, question results, operation evidence, grants, reservations, recovery acknowledgements and artifacts are also retained. There is no automatic history pruning. Pi histories live below `sessions/<conversation>/sessions/<session>` and task workspaces below `workspaces/<task>`. Published artifact files remain available after a failed import. Do not delete the journal or artifacts while the host is running.

SQLite uses Node's built-in `node:sqlite`, with foreign keys and FULL synchronous commits. Its storage schema v5 is reported separately as `journalSchemaVersion`; shared discovery protocol/schema compatibility remains v2. Newer database schemas are rejected. Migrations retain unknown historical timestamps as zero rather than inventing dates. No automatic legacy-history import occurs.

Native mutation evidence remains bounded. Expired evidence can leave an operation permanently uncertain. Recovery requires explicit inspection acknowledgement plus fenced, idle native scopes and operations, or confirmed exit of the original process. It records a disposition and permits fresh work without changing the old unknown outcome or satisfying its dependencies. Unresolved launches have a separate inspection-based recovery action. It requires the original root to have lost launch authority, no in-flight spawn, no live recorded spawn candidate, and an empty Rhino process list. It preserves the old launch outcome and allows only a freshly granted launch.

## Native acceptance and review

See [platform checks](shared-host-platform-probes.md) for exact build identities, package checks and observed Mac behavior, and [the operation audit](shared-host-native-operation-audit.md) for native routing and cleanup policies. Launch stays unavailable for installations without a passing build-specific bootstrap/readiness record. An additional independent Mac process is intentionally unsupported under the user's revised scope.

Independent adversarial reviews covered task admission, question suspension, steering consumption, stale queued native owners, uncertain cleanup, registration/startup races, destination writes, recovery and browser takeover. Reproduced defects were fixed with regression tests. The startup cycle and stale-attachment polling delay were also reproduced in actual packaged Mac execution.

Windows ACLs, detached lifetime, first/additional process launch and native transfer require the Windows packaged acceptance suite before rollout there. Sleep/wake and the full native crash matrix remain platform acceptance work. These gates are not marked passed by unit tests.

Before the default-startup cleanup, local verification passed `pnpm build`, 630 TypeScript tests across 75 files, 242 C# Core tests, and 101 shared-host tests on Node 22.19.0. Rhino and Grasshopper builds passed. The checked-in `scripts/shared-host-native-smoke.mjs` passed against the packaged Mac plugin. The final adversarial review also checked launch recovery across restart, including late spawn evidence.

The default-startup cleanup removes the opt-in environment setting, owned-child host entry, and separate browser application. The normal UI retains model/provider/thinking controls, skills, tools, exports and image composition while showing available documents and exact task destinations. Independent review found and fixed explicit reopen after Stop host, unnecessary same-host re-registration, and mismatched skill-setting paths. Native recovery contract tests now cover stopped-host restart, healthy reopen, concurrent discovery and cancellation. Desktop and mobile browser fixtures were visually checked. These checks do not replace a fresh packaged native acceptance run for the startup changes.

Cleanup validation passed the production build, 631 TypeScript tests across 74 files, and 245 C# Core tests. Rhino builds passed; Grasshopper builds passed with the existing platform warnings.
