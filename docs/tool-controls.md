# Tool controls

Tool controls use a shared policy store, guarded runtime registration, Agent tools controls, external Pi menus, and a registry of bundled plugins. See [adding and removing plugins](plugins.md).

## Policy and execution

`tool-policy.ts` defines permission, availability, exposure, conditional updates, enable revisions, and credential generations. `tool-policy-store.ts` serializes authoritative reads, field patches, repairs, and execution admissions through an OS-released file lock. It writes settings atomically and treats corrupt or missing initialized settings as an error. Catalog additions append missing tool preferences under the same lock and advance the revision once. Retired tool IDs stay in storage, preserving opt-outs when tools return or hosts use different catalogs.

`policy-inventory.ts` includes the main catalog, viewport capture, discovery, both choice tools, embedded skill reading, and Firecrawl. Each tool has a namespaced preference ID and one parent gate. Each registered plugin supplies its own inventory and factory. Registrations happen after Pi binds the registry so existing tool-name conflicts can be detected without replacement. Foreign Pi tools remain unmanaged.

`tool-policy-runtime.ts` applies the policy to definitions and execution. The registration wrapper checks policy once before execution and rechecks if backend recovery was needed. Async-local dispatch context carries the originating session and cancellation state into backend calls. The socket send path obtains fresh admission after asynchronous prerequisites. Script batches retain their own admission before each backend invocation so denied runs are recorded as not started. Firecrawl reads a protected key outside the policy lock, then validates the current epoch, generation, reference, permissions, and session under that lock before the request.

Disables block new admissions once committed. Watcher updates provide UI refresh and best-effort Firecrawl cancellation, but never authorize execution. Already admitted calls may finish. Enable revisions prevent a disable-and-enable cycle from reviving an old definition. Manual activations are tied to a session generation and discarded on replacement, repair, or a later disable.

## Request boundaries

The embedded host reconciles definitions after Pi's continuation compaction and before copying tools into the next request context. Both modes also reconcile before the initial prompt, after tool turns, and after compaction. An idle watcher cannot apply an enable after a prompt has become busy. Unchanged active tool lists are left alone. Disabled Firecrawl tools do not read protected storage during reconciliation or settings refresh; a saved reference supplies their setup display. Credential-status waits have a two-second deadline and release early when newer settings, session replacement, or shutdown make them obsolete. New reconciliation requests reread settings before joining a blocked queue, so missed watcher events cannot keep a disabled provider in the way of the next model request. Late native completions are ignored. Enabling Firecrawl checks protected storage, and execution always reads and validates the current key. Discovery ranks the full catalog before applying the activation limit, so active or unavailable matches cannot hide later eligible tools. The system prompt is rebuilt from current exposure rather than preserved in a per-turn override; disabling the embedded skill reader removes its skill catalog guidance.

External Pi's public extension API does not expose the embedded host's final request-context callback. It uses the pre-prompt, tool-turn completion, and compaction events. Offline real-SDK tests verify changes during a response appear in the next continuation in both modes. Execution admission still consults the latest store independently of those events.

## Setup and controls

The authenticated, bounded `/api/tools` configuration endpoint transports validated field patches and separate credential actions with an explicit plugin ID. Parent summaries carry each plugin's name, description, credential label, notice, and status; both interfaces generate controls from these summaries. Tool schemas are serialized once per schema object. Settings saves reuse the reconciled snapshot for both the response and websocket publication, and unchanged snapshots are not published again. Connected dialogs apply websocket snapshots directly and reject stale responses; reconnect and a 30-second fallback poll recover missed updates. Switches retain confirmed values while saving, and a conflict refreshes the current snapshot without replaying an edit.

Firecrawl starts disabled. The parent switch controls enablement independently of key setup. Use "Manage API key" to save or replace a key without changing the switch. Tools that require a key remain unavailable until it is configured; credential-free tools can run without setup. Removal commits a tombstone before attempting deletion. No Firecrawl credential appears in ordinary settings or session history.

See [storage and recovery](tool-policy-storage.md) for platform backends and profile paths, and [Firecrawl](firecrawl.md) for payloads, limits, billing references, and destination-validation limits. The normal Rhino package build includes and verifies the target native lock and keyring dependencies.
