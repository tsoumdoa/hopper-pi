# Optional plugins and tool controls

## Objective

Add Firecrawl as an optional plugin and give users persistent controls over the tools Hoppercode can use. Firecrawl starts disabled. Existing Rhino and Grasshopper tools keep their current defaults.

Users can enable or disable a plugin, disable individual tools, and see why a tool is unavailable. Agent-driven tool discovery must respect those choices across conversations, model changes, and restarts.

## First release scope

- Bundle a disabled-by-default Firecrawl module with Hoppercode. Enabling it requires no package installation or Rhino restart.
- Provide web search and webpage reading through Firecrawl.
- Extend the existing Agent tools dialog with plugin/group switches and individual tool switches.
- Persist preferences at application level, outside conversation history.
- Use the same tool policy in the embedded Rhino host and the external Pi extension workflow.
- Keep Firecrawl credentials separate from ordinary preferences and session exports.

Defer downloadable third-party plugins, a marketplace, general plugin lifecycle hooks, environment-variable credentials, session-specific preference overrides, action-level permissions, and strict read-only or network-isolation modes. Session activation is temporary exposure of an allowed tool, not a preference override.

## User experience

The Agent tools dialog groups tools under Rhino, Grasshopper, Firecrawl, and other relevant groups. Rhino and Grasshopper start enabled; Firecrawl starts disabled.

Turning Firecrawl on without a configured key opens setup. The user supplies their own API key and sees a short explanation that search queries and requested URLs are sent to Firecrawl and may consume credits on their account. The setup action is labeled "Save key and enable" and explicitly authorizes both operations. Cancel leaves Firecrawl disabled. Saving a key through "Manage API key" alone does not authorize enabling the plugin. Report success only after protected storage and the policy update succeed.

Firecrawl exposes separate switches for web search and webpage reading. Both child preferences start enabled, but the disabled parent blocks all access until setup is complete. Disabling the plugin preserves its credentials and individual tool preferences. Re-enabling restores those preferences. Removing the API key disables access until another key is configured.

Group switches are master gates. Switching a group off does not overwrite its individual tool settings. The dialog displays child settings as unavailable while the parent is off and explains why. Firecrawl has one parent switch, not separate plugin and group switches with identical membership. Plugin ownership remains metadata; each tool has one user-facing parent gate in v1.

Show user settings separately from runtime status:

| Display | Meaning |
| --- | --- |
| Disabled by you | The tool's switch is off |
| Plugin or group disabled | A parent switch blocks the tool |
| API key required | The plugin is enabled but credentials are missing |
| Image-capable model required | The selected model cannot use this tool |
| Backend unavailable | The required Rhino/Grasshopper connection is unavailable |
| Available on demand | Allowed and discoverable, but not currently exposed to the model |
| Activation required | Allowed, but discovery is disabled; activate through settings |
| Settings unavailable | Policy cannot be read safely; execution is blocked |
| Credential store unavailable | Protected credentials cannot be accessed |
| Active | Allowed and currently exposed to the model |
| Applies before the next model response | Preference saved; the current session has not yet refreshed its tool definitions |

Once a Firecrawl disable is committed, no new request may be admitted, including background credential or credit checks. Already admitted requests are in flight and receive best-effort cancellation. Preserve already returned results in conversation history.

### User stories and timing

| User intent | Steps | Result |
| --- | --- | --- |
| Enable Firecrawl for the first time | Open Agent tools, switch Firecrawl on, enter an API key, click "Save key and enable" | Save the key securely and commit enablement. In default mode, tools with valid credentials and enabled child switches become usable before the next model request in this conversation. No new thread or Rhino restart is needed. |
| Enable Firecrawl again | Open Agent tools and switch Firecrawl on | Reuse the saved key and restore individual tool choices. If the key is missing, open setup. A locked store shows an error and keeps execution blocked. |
| Disable only webpage reading | Expand Firecrawl and switch "Webpage reading" off | Once saving succeeds, block new calls to `web_fetch` in this conversation and every host using the same profile. Web search remains allowed. |
| Disable Firecrawl entirely | Switch Firecrawl off | Once saving succeeds, block new search, fetch, and provider-check requests immediately. Attempt to cancel in-flight Firecrawl work. Keep the key, child preferences, and past results. |
| Disable a built-in tool or group | Open Rhino or Grasshopper and switch a tool or its parent off | Block new admissions immediately after saving, including later scripts in a batch. Already admitted operations may finish. Keep the setting in future threads and after restarts. |
| Re-enable a tool while Hopper is responding | Switch the tool on | Save the choice immediately. Show pending exposure until the next model request, which can occur within the current agent turn. The current response does not gain a new tool definition midway through generation. |
| Use an enabled specialist in progressive mode | Ask Hopper for the capability, or click "Activate for this session" beside the tool | Discovery activates it when allowed. The manual action also works with discovery disabled. Exposure updates before the next model request; a fresh session resets temporary activation. |
| Remove or replace a key | Open Firecrawl, choose "Manage API key", then "Remove key" or "Save replacement" | Removal immediately blocks new requests after its policy commit and leaves the plugin switch unchanged. Replacement becomes the key for new admissions after a successful save and publication. Neither action changes tool preferences. |
| Recover a disconnected backend | Reconnect Rhino, then click "Check connection" in Agent tools | Refresh availability and rebuild exposure before the next model request. Explicitly disabled tools stay disabled. |
| Resolve a change made in another window | Read "Settings changed in another window; review and try again" and the refreshed switches | The conflicting edit is not replayed. Make a new switch change if still wanted. |

Switches save individually; there is no separate Apply button. Show "Saving" until the host acknowledges the committed update. Failed saves show an error and restore the latest confirmed setting. Do not claim a disable succeeded while disconnected or after a failed write. Pending exposure is distinct from saving: the preference is already saved, but the model has not received its updated tool list.

All persistent choices apply to current and future conversations in the same application profile. A model-request boundary is the point immediately before Hopper sends a request to the model, including a continuation after tool results. An idle session applies exposure changes before its next request. A new thread is never required just to apply a preference.

## Tool policy

Separate three concepts that the current `active` field does not capture:

- **Enabled:** the user allows the tool and its parent plugin/group.
- **Available:** requirements such as credentials, backend access, and model capabilities are met.
- **Active:** the tool definition is currently exposed to the model.

Execution requires all three:

```text
callable = parent gate enabled
           AND tool enabled
           AND requirements met
           AND active in the current session
```

Create one shared policy service that resolves these states and reasons. Route tool activation, progressive discovery, session resets, and model-dependent activation through it. An explicit disable always wins over default activation or agent discovery.

Filter disabled tools from the model-facing catalog and discovery results. Keep them visible in the user-facing settings catalog. Check policy again immediately before execution so an old tool call cannot bypass a newer preference.

Runtime transitions may change availability or activation, but must never rewrite user preferences. Existing `alwaysActive` metadata means active by default when allowed, not exempt from user control.

Register every exposed Hopper tool with this policy, including interaction tools, viewport capture, and the host's skill-reading tool. If a tool is disabled, prompt guidance must not claim that it is usable.

### Activation and recovery

Keep the existing non-progressive default: all allowed tools with satisfied requirements are active. In progressive mode, retain the current core defaults and make Firecrawl tools discoverable specialists. Enabling a plugin does not bypass progressive activation.

Discovery remains subject to its own tool and group switches. Add an "Activate for this session" action for allowed, available tools in the dialog and an equivalent external Pi command. This action does not depend on discovery, change saved preferences, or bypass parent gates. Apply it at the next model-request boundary. When discovery is disabled, show inactive specialists as "Activation required" with this action. Fresh sessions reset manual activation according to existing progressive rules. Tie pending manual activation to the current session generation, and discard it on session replacement or a later tool/parent disable. Never replay it to change saved preferences.

Backend recovery must not depend on calling a currently unavailable tool. Provide "Check connection" in the dialog and an equivalent external Pi action. Also refresh backend status before a model request when the cached backend is offline or unknown and an enabled tool needs it. Perform the probe outside policy locks, then reconcile exposure. A failed probe never changes preferences.

### Changes during an agent turn

- Commit disables immediately, without waiting for the agent turn to finish. Subsequent execution admissions in every host must read the committed policy.
- Remove disabled definitions at the next safe model-request boundary.
- Abort outstanding Firecrawl requests where possible. Requests already received by the provider may still consume credits.
- Do not claim that disabling a tool reverses an operation already underway.
- Commit both enables and disables immediately. Defer only session exposure until the next model-request boundary; derive it from the latest policy instead of replaying queued enable operations. Show pending exposure when a session is busy.
- Until reconciliation, execution must satisfy both the session's applied permissions and the latest authoritative policy. Thus a new enable waits for reconciliation even if an old definition is still present, while a new disable blocks immediately. Retain the last enable revision for each gate so disable-then-enable between reconciliations cannot revive a stale definition; its enable revision must be covered by the session's applied revision.
- Publish a successfully saved credential replacement immediately through a conditional policy update. New admissions use the published generation; already admitted requests remain in flight. No turn-boundary credential publication queue is needed.
- Serialize short policy and session-state transitions with prompt admission and session replacement. Never hold the settings lock for a full prompt, backend probe, or provider response.

### Execution admission

Before asynchronous prerequisite work, check saved user permission, session validity, and cancellation. Do not reject solely because backend availability is cached as offline or unknown; permitted calls must be able to refresh it. After prerequisite work completes, obtain a fresh full execution admission immediately before dispatch, including current requirements and session exposure. Admission and preference updates use the same cross-process ordering described below. An admission committed before a disable counts as in flight, even if transport dispatch follows a moment later; a queued call without admission does not. Do not pre-admit queued work.

Authorize each script separately in a multi-script call. Disabling between scripts prevents later scripts from being admitted but does not undo a script already dispatched. Place guards in the actual dispatch paths as well as registration wrappers, including after `withBackendGuard` awaits backend refresh.

Every Firecrawl attempt needs a fresh admission and the current credential generation. Cancellation and key removal invalidate pending attempts. Do not reuse admission tokens for retries or across session replacement.

## Plugin structure

Use static internal plugin descriptors with a stable ID, display name, default enabled state, tool definitions, and configuration requirements. Extend the tool catalog with stable ownership, one parent preference gate per tool, and prerequisite metadata. Defer a general lifecycle-hook API until another plugin demonstrates a need.

Keep Firecrawl's client, configuration, tools, and request cancellation inside its module. The core runtime handles settings, policy, registration, and UI transport without knowing Firecrawl request details.

Import bundled plugin descriptors explicitly; use local tool factories only where runtime dependencies require them. Retain the embedded host's isolated extension-loading behavior. This first release does not load arbitrary third-party code.

Use stable namespaced preference IDs, separate from model-facing tool names. Requirements are a list of gates that must all pass, so viewport capture can require both image input and backend access. Detect model-facing name collisions before registration; report the conflicting plugin as unavailable and never replace another extension's tool.

Maintain an explicit registration inventory covering the main catalog, discovery, dynamic viewport capture, host skill reading, and both choice tools. Every Hopper-owned registration must resolve through guarded policy. External Pi built-ins and unrelated extension tools remain outside these controls and are labeled as unmanaged if shown.

### Shared settings and consistency

Store `tool-settings.json` in one per-user Hopper application configuration directory, independent of project, conversation, and Rhino instance. Both runtime modes resolve this same directory by default. An explicit configuration-directory override creates a separate profile and is documented as outside cross-profile synchronization.

Version the schema and give each successful update a monotonically increasing revision. Accept field-level patches with an expected policy epoch and revision. Under a cross-process lock, read the latest file, validate, apply the patch, and write atomically before acknowledging success. Reject stale revisions with a conflict response and the current snapshot. For v1, never automatically replay a conflicting patch, even if it touches different fields. Refresh the controls, explain the conflict, and require a new user action. A rejected edit must not appear saved. Never accept a stale whole-file replacement. This avoids an old enable being retried after a newer disable, including when the field changed more than once.

Execution admission takes the same lock and reads the authoritative policy before authorizing work. A watcher updates UI and model definitions but is never the execution authority. This gives a precise cross-host promise: an admission ordered after a committed disable is denied, even when that host has missed notifications. Publish revisions to connected clients and refresh snapshots on reconnect.

Use an OS-released lock or a locking implementation with verified owner-death recovery. Do not steal a lock merely because a request took too long. If the lock or current policy cannot be read safely, deny new admissions and show a recoverable settings error.

Track initialization with a persistent profile marker separate from `tool-settings.json`. Under the same lock, create the marker before the initial atomic settings write. A missing store with no marker on a genuinely new profile initializes defaults. A marker with no settings file, including an interrupted initialization, blocks execution and offers explicit repair. A running host that has already observed settings must also block if the file disappears, even if the marker disappears too. Removing the entire profile while no host is running is treated as a new profile; do not claim to recover choices from a deleted profile.

Migrate supported schemas while preserving explicit choices. Corrupt files and unsupported future schemas block Hopper execution; preserve the file and offer explicit repair or reset. Never silently fall back to defaults. Restoration of defaults is a revisioned user action and leaves Firecrawl disabled.

When the current revision is unreadable or missing, explicit repair starts a new policy epoch under the lock; reject all updates and admissions tied to the previous epoch. Preserve readable credential tombstones where possible; after repair, require explicit credential reconfiguration rather than adopting an old protected entry automatically.

## Firecrawl tools

| Tool | Endpoint | Behavior |
| --- | --- | --- |
| `web_search` | `/v2/search` | Return a bounded list of titles, URLs, and relevant excerpts |
| `web_fetch` | `/v2/scrape` | Return readable Markdown for one selected URL |

Search first, then fetch only useful pages. Pin search to web results, omit `scrapeOptions`, and parse the documented grouped web response. Fetch requests ask for Markdown only. Do not expose arbitrary provider options to the model. Keep the provider behind an adapter so tool definitions do not depend on a specific SDK.

Support validated include/exclude domain filters. Use these initial application limits, independently of provider maxima:

| Limit | First-release value |
| --- | --- |
| Search results | Default 5, maximum 10 |
| Search query | Maximum 2,000 characters |
| Fetch URL | Maximum 8,192 characters |
| Decoded provider response | Maximum 2 MiB; abort reading above the cap |
| Returned search text | Maximum 20,000 characters total |
| Returned fetch text | Maximum 50,000 characters |
| End-to-end deadline | 30 seconds for search, 60 seconds for fetch |
| Automatic retries | None in the first release |

Preserve source URLs and code blocks where they fit, report truncation, and handle absent or malformed fields. Return sanitized missing-key, authentication, quota, timeout, cancellation, and response-size errors. A manually repeated request may incur another charge. Do not add automatic retries without defining which failures are safe and rechecking policy for every attempt.

Accept HTTP/HTTPS URLs intended for public webpages. Parse and canonicalize with the platform URL parser before validation. Reject userinfo, localhost and local-only hostname forms, and IP literals in loopback, private, link-local, unspecified, multicast, or reserved ranges. Normalize unusual numeric IPv4 forms and IPv4-mapped IPv6 before checking ranges. Reject single-label and `.local` hostnames. Do not locally fetch or resolve a target as a preflight check.

This is an input-validation guarantee. Firecrawl resolves hostnames and follows redirects remotely, so it does not prove that every provider-side destination is public. Before release, document the provider's destination and redirect protections and their limits. Do not claim private-destination blocking unless those guarantees are established. Strong destination isolation remains outside first-release scope.

Treat retrieved text as external content, not agent instructions. Provide guidance to prefer official documentation for API questions and cite retrieved sources.

### Credentials and failure handling

Resolve and prototype the credential backend in phase 1. Use macOS Keychain, Windows Credential Manager, and a Secret Service backend on supported Linux desktops. Verify the selected bindings in packaged builds. If protected storage is unavailable or locked, show that status and block Firecrawl; never fall back to a plaintext file. Embedded setup must not report a key as saved until the protected write succeeds.

Do not put secrets in browser local storage, ordinary settings, logs, tool results, or exported sessions. UI responses expose credential status only. A user-entered key travels through an authenticated, size-limited configuration endpoint and is cleared from the form after submission. Return fixed sanitized error codes, never raw credential-backend or provider error messages.

Store a non-secret credential generation and enabled credential reference in shared policy. Removal first commits a tombstone and generation change that blocks new admissions across hosts, then deletes the protected secret. If deletion fails, keep access blocked and display a retryable deletion error.

For setup and replacement, capture the current policy epoch, revision, and credential generation before the protected write. Save to a new protected entry outside the settings lock, then conditionally publish the reference under the lock only if that starting state still matches. A later disable, key removal, reset, or other policy update makes publication fail with a conflict; never silently retry it. Setup may atomically enable the parent during publication only when the user chose "Save key and enable". A failed or superseded publication leaves the latest policy intact and reports that setup was not applied. Orphaned entries from interrupted or superseded updates never authorize requests; delete them on a best-effort basis. Cached keys never authorize requests without checking the current shared generation.

Both embedded and external Pi modes use the same protected credential store and profile-scoped reference in v1. External Pi provides an interactive masked credential-entry action and equivalent enable, disable, remove, and replace controls; never accept a secret as a command-line argument. Environment-variable credentials are deferred and their presence does not enable Firecrawl. A host unable to access the configured protected entry reports unavailable and blocks Firecrawl without changing shared preferences or trying another source.

No account or balance polling runs while disabled. Do not present local request counts as an authoritative provider bill.

## Existing integration points

| File | Planned change |
| --- | --- |
| `src/tools/catalog.ts` | Add ownership, defaults, and requirement metadata |
| `src/index.ts` | Register plugin tools and apply shared policy |
| `src/tools/hopper-search-tools.ts` | Respect policy during discovery, activation, and resets |
| `src/services/rhino-capture-model.ts` | Preserve user disables during model changes |
| `src/host/pi-runtime.ts` | Bind shared policy to session lifecycle, host skill tools, and snapshots |
| `src/tools/with-backend-guard.ts` and script dispatch paths | Recheck admission after asynchronous setup and per script |
| `src/extensions/choices/register-ask-user.ts` and `register-pick-option.ts` | Register interaction tools through policy |
| New shared settings and credential services | Own revisions, locking, protected storage, and credential generations |
| `src/host/protocol.ts` | Add plugin/tool settings and effective-status types |
| `src/host/server.ts` | Add authenticated settings and credential updates |
| `web/src/components/tools-dialog.tsx` | Add switches, setup, status reasons, and pending states |

The current `/api/tools` endpoint is read-only. Extend the host API with validated updates and publish state changes to connected clients. Keep credential operations separate from ordinary tool preference updates.

## Implementation phases

### 1. Shared policy and persistent preferences

- Define settings, plugin metadata, status reasons, and migration behavior.
- First prototype cross-process locking and atomic writes on supported packaged platforms. Verify owner-death recovery before building the controls around this guarantee.
- Implement the revisioned shared store, profile initialization marker, repair epochs, cross-process admission ordering, conflict responses without automatic replay, and failure behavior.
- Complete the registration inventory and prototype protected credential storage on supported packaged platforms.
- Introduce registration guards and dispatch admission, including backend awaits and individual scripts in batches.
- Update progressive discovery, capture activation, session lifecycle, backend recovery, and skill prompt rebuilding. Derive session exposure from current preferences at model-request boundaries.
- Preserve existing tool defaults on a genuinely new profile. Missing settings on an initialized profile require explicit repair.

### 2. Tool controls

- Extend host snapshots and authenticated configuration endpoints.
- Add group/plugin switches and per-tool controls to Agent tools.
- Display disabled, unavailable, on-demand, active, and pending states distinctly.
- Add session activation without discovery, revision-aware restoration of defaults, and equivalent controls in external Pi mode.

### 3. Firecrawl plugin

- Implement the bundled optional module and provider adapter.
- Add credential setup, disable, and key removal flows.
- Implement the specified request payloads and numeric limits with policy admission and cancellation.
- Document provider destination and redirect protections without overstating local URL validation.
- Add research guidance and ensure release packaging includes the plugin.

### 4. Verification and documentation

- Run focused unit and integration tests, then repository type checks, tests, and the UI build.
- Verify the dialog in the browser, including narrow layouts and reconnection.
- Run a small live smoke test with an explicitly configured test key. Keep normal automated tests offline.
- Document setup, credit usage, storage, opt-out behavior, and external Pi configuration.

## Acceptance criteria

- A fresh install retains existing tools and makes zero Firecrawl requests.
- Enabling Firecrawl with valid credentials makes its allowed tools usable without restarting Rhino.
- Missing or invalid credentials produce actionable status without exposing the key.
- Disabling the plugin blocks both tools, preserves child preferences, and survives restart.
- Disabling one tool leaves the other usable when its requirements are met.
- Disabling a built-in tool survives progressive discovery, new/resumed sessions, reloads, and model changes.
- Pause update notifications in host B, commit a disable in A, and verify a new admission in B is denied. Calls admitted before the commit count as in flight and have separate cancellation tests.
- Pause backend refresh, disable the tool, then resume; no execution is admitted. Disable between batch scripts and verify remaining scripts are blocked.
- No pending Firecrawl attempt restarts after cancellation or key removal.
- During streaming, enables save immediately and exposure changes before the next model request. Enable, then disable before that boundary; the tool must stay disabled. Repeat across session replacement and with an old definition still present.
- Start offline, connect Rhino, and recover through "Check connection" or the next model-request preflight without a session restart. A cached offline state must not prevent the refresh; disabled tools remain disabled.
- Concurrent edits produce either a committed update or a visible conflict, never a silent overwrite or false success. Pause an enable in A, commit a disable in B, then resume A: A must refresh without automatic replay. Test fields changed multiple times and edits to different fields. Reconnected tabs display the latest revision.
- Process death during an established settings update releases the lock safely and leaves a valid old or new file. Test interrupted initialization, missing settings with a marker at startup, and deletion while a host is running. These cases, corrupt files, and future schemas never silently restore defaults. Explicit repair invalidates old-epoch requests and leaves Firecrawl disabled.
- With discovery disabled in a fresh progressive session, the user can activate an allowed specialist through the dialog or external Pi command.
- Enumerating registrations in both runtimes finds policy ownership and guards for all Hopper tools, including late capture registration, host skill reading, and both choice tools. Name collisions never replace another extension's tool.
- Pause a setup or replacement protected write, remove the key or disable Firecrawl in another host, then complete the write. Publication must fail without restoring access. Repeat after reset and verify orphaned entries cannot authorize requests.
- Locked or unavailable credential stores and failed saves produce actionable status. Failed deletion leaves access blocked across two hosts, including hosts with cached keys.
- A sentinel secret injected into backend/provider failures never appears in snapshots, ordinary preference files, errors, logs, or session exports.
- Search results and fetched pages retain source URLs, obey output limits, and handle timeout, authentication, quota, and cancellation failures.
- URL validation rejects userinfo, local hostname forms, IPv6 loopback, IPv4-mapped private IPv6, and unusual numeric private IPv4. Tests model private DNS answers and private redirects to demonstrate the documented provider boundary, without claiming local validation blocks them.
- Adapter tests assert web-only search without scraping, grouped response parsing, all numeric caps, and zero automatic retries.
- Both embedded host and external Pi workflows respect the same policy rules and protected credential reference within a profile. Different environment-variable values have no effect. A host without protected-store access blocks Firecrawl and reports that reason.
- Verify each user-story flow, including setup cancellation, save failure, pending exposure, key replacement without enablement, and a disconnected settings client. No flow requires a new thread to apply a saved preference.

## Limits of tool switches

Tool switches control named tool calls. They are not a sandbox for equivalent operations. An enabled general-purpose Rhino script tool may still modify geometry or access the network even when a dedicated tool is disabled.

Do not advertise strict read-only or no-internet guarantees without controlling those execution paths. Action-level controls for tools that combine open/save/close or other operations require a separate design.

## References

- [Firecrawl search](https://docs.firecrawl.dev/features/search)
- [Firecrawl scrape](https://docs.firecrawl.dev/features/scrape)
- [Firecrawl billing](https://docs.firecrawl.dev/billing)
- [Firecrawl pricing](https://www.firecrawl.dev/pricing)

Search and scrape documentation was checked during the September 8, 2026 review. No authenticated requests were made; billing and provider-side destination enforcement were not verified. Recheck endpoint schemas, credit rules, and destination protections when implementing the adapter.
