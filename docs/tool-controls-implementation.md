# Tool controls implementation

The implementation follows `plan.md` with a shared policy store, guarded runtime registration, Agent tools controls, external Pi menus, and the bundled Firecrawl adapter.

## Policy and execution

`tool-policy.ts` defines permission, availability, exposure, conditional updates, enable revisions, and credential generations. `tool-policy-store.ts` serializes authoritative reads, field patches, repairs, and execution admissions through an OS-released file lock. It writes settings atomically and treats corrupt or missing initialized settings as an error.

`policy-inventory.ts` includes the main catalog, viewport capture, discovery, both choice tools, embedded skill reading, and Firecrawl. Each tool has a namespaced preference ID and one parent gate. The Firecrawl descriptor supplies its own inventory metadata. Registrations happen after Pi binds the registry so existing tool-name conflicts can be detected without replacement. Foreign Pi tools remain unmanaged.

`tool-policy-runtime.ts` applies the policy to definitions and execution. Registration wrappers check permission before prerequisites. Async-local dispatch context carries the originating session and cancellation state into backend calls. Backend guards recheck after refresh; runtime RPC and the socket send path obtain fresh admission after awaits. Script batches check each dispatch separately. Firecrawl reads a protected key outside the policy lock, then validates the current epoch, generation, reference, permissions, and session under that lock before the request.

Disables block new admissions once committed. Watcher updates provide UI refresh and best-effort Firecrawl cancellation, but never authorize execution. Already admitted calls may finish. Enable revisions prevent a disable-and-enable cycle from reviving an old definition. Manual activations are tied to a session generation and discarded on replacement, repair, or a later disable.

## Request boundaries

The embedded host reconciles definitions after Pi's continuation compaction and before copying tools into the next request context. Both modes also reconcile before the initial prompt, after tool turns, and after compaction. An idle watcher cannot apply an enable after a prompt has become busy. The system prompt is rebuilt from current exposure rather than preserved in a per-turn override; disabling the embedded skill reader removes its skill catalog guidance.

External Pi's public extension API does not expose the embedded host's final request-context callback. It uses the pre-prompt, tool-turn completion, and compaction events. Offline real-SDK tests verify changes during a response appear in the next continuation in both modes. Execution admission still consults the latest store independently of those events.

## Setup and controls

The authenticated, bounded `/api/tools` configuration endpoint transports validated field patches and separate credential actions. Websocket snapshots refresh connected dialogs; reconnect and polling recover missed updates. Switches retain confirmed values while saving, and a conflict refreshes the current snapshot without replaying an edit.

Firecrawl starts disabled. Setup's "Save key and enable" action authorizes protected storage and enablement together. Managing a replacement key does not change the switch. Removal commits a tombstone before attempting deletion. No Firecrawl credential appears in ordinary settings or session history.

See [storage and recovery](tool-policy-storage.md) for platform backends and profile paths, and [Firecrawl](firecrawl.md) for payloads, limits, billing references, and destination-validation limits. The normal Rhino package build includes and verifies the target native lock and keyring dependencies.

## Verification limits

Offline tests cover policy transitions, authoritative cross-host admission, native owner death on the development Mac, credential races, backend-await and per-script revocation, session replacement, real Pi registration and continuation refresh, settings API validation, UI saves and conflicts, adapter payloads and limits, and native package inventories.

TypeScript, the release TypeScript build, and the production UI build are checked. No live Firecrawl, model, or Rhino integration call is required by these tests. Live Firecrawl verification is deferred until a test key is configured. Browser visual QA was unavailable because no browser connection was exposed. Windows/Linux native execution and real OS credential writes remain platform smoke checks.
