# Shared host implementation status

This is the first implementation slice of [the shared host plan](shared-host-multi-rhino-plan.md). No milestone is complete yet. Owned-child mode remains the only running host mode.

Implemented foundations:

- Each embedded host has an injected runtime context. RPC turn state, connection profiles, document aliases and backend caches belong to that context. Registered tools and lifecycle hooks restore their owning context even when invoked outside the original asynchronous call chain.
- TypeScript and C# validate the same target and execution-owner shapes. An exhaustive operation policy distinguishes reads, journaled mutations and controls with host-only recovery records. Every shared operation remains disabled pending the native document-routing audit.
- `TaskJournal` uses SQLite transactions for submission receipts, immutable submission payloads, task/turn state, semantic events, steering intent, questions and single-use answers. Duplicate request IDs return the original receipt and conflicting payloads fail. A question becomes answerable only after the caller confirms cleanup. Answers create fresh turns. Restart retains queued work and marks possibly started work uncertain without replaying it.
- The question suspension adapter has tests against Pi 0.85.1, including a mixed tool batch, persistence failure, queued inputs and on-disk history. See [the suspension prototype](shared-host-pi-suspension-prototype.md).

The journal and suspension adapter are not yet connected to browser commands or a shared scheduler. They are not authorization services. Callers will need authenticated command admission, immutable attachment storage, native cleanup evidence and process ownership before using them for shared execution. The initial journal schema is provisional and has no production migration obligation because shared mode is not enabled. Do not point it at legacy session storage.

## SQLite adapter and packaging

The selected prototype adapter is Node's built-in `node:sqlite` `DatabaseSync`, loaded lazily when constructing a journal. It adds no native npm dependency. The existing minimum runtime is Node 22.19.0. The adapter enables foreign keys and FULL synchronous commits, and applies the initial schema inside an immediate transaction. The database's generated identity survives reopen. A schema version newer than this implementation is rejected.

The staged host smoke script now exercises journal creation and acceptance deduplication using the selected external Node executable. Local tests run on macOS with Node 26.8.1 and the minimum Node 22.19.0. Node 22 reports SQLite as experimental. Windows staged runtime validation remains required before adopting the adapter for shared mode.

This schema does not yet implement operation dispatch evidence, attachment ownership, grants, reservations, artifacts, launch records, model usage, payload retention, or recovery release dispositions. Recovery therefore conservatively leaves possibly started turns uncertain. There is no API to acknowledge and release that uncertainty yet. Steering receipts identify the input; its current application state is obtained from the journal snapshot.

## Remaining delivery gates

Milestone 1 still requires the rest of the journal contract and scheduler integration, task-bound document contexts, durable attachment retention, and packaged SQLite verification on both platforms. The Pi boundary proves driver behavior, not native scope cleanup.

Milestone 2 still requires per-user singleton/control locking, pinned storage, persistent browser credentials, detached lifetime, reattachment and launch/bootstrap prototypes. First and additional Mac processes must be validated independently. No Rhino launch or native lifetime claim follows from this PR's mocks.

Milestones 3 through 8 remain planned. Shared browser admission, process scheduling, native fencing, document routing, target selection, bounded document actions, delegation, Rhino launch and `.3dm` transfer are not shipped by this slice. Launch and transfer remain required for overall completion.

## Verification and adversarial review

Local validation passed `pnpm build`, all 525 TypeScript tests across 61 files, all 229 Hopper.Core C# tests, and 28 focused tests on Node 22.19.0. A compiled journal acceptance smoke also passed on Node 22.19.0. The modified staged package smoke has not yet been run against Windows or macOS release packages.

Independent reviewers examined session isolation, host integration, journal transitions and the Pi boundary after implementation. They reproduced four defects: a process-wide component catalog, settlement through an old suspended turn, unordered steering delivery, and sparse-array payload encoding. All four were fixed with regression tests, and both reviewers verified the final fixes. This review does not replace the plan's packaged Rhino acceptance checks.
