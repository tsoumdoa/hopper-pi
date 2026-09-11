# Shared host platform checks

Current scope: Windows additional-process launching uses `launchRhino` and ordinary `HopperCode` registration, without `HopperBootstrap`. The bootstrap results below are historical evidence for an earlier build, not acceptance evidence for this Windows launch path. The Mac document/transfer fixture requires a manually opened empty Rhino document connected through `HopperCode`.

## Windows additional-process launch check, 2026-09-11

The new `scripts/windows-rhino-launch-smoke.mjs` fixture passed against Rhino 8.33.26188.13001 on Windows. It used the production launch service and process adapter, observed the running host's authenticated registrations through a read-only journal connection, and kept fixture tasks/access records in a separate SQLite database. It made no model calls and did not edit geometry.

The first attempt exposed a native argument-parsing requirement: `/runscript=_HopperCode` opened a blank Rhino but did not execute the command. That request timed out with its one process recorded and no delegation authority. Manually running `HopperCode` confirmed that the rebuilt native plugin could connect; the blank test process was then closed normally.

The corrected adapter preserves literal macro quotes with fixed arguments and `windowsVerbatimArguments: true`, passing `/nosplash /notemplate /runscript="_HopperCode"` without a shell. Source PID 24096 remained open, and worker PID 25180 registered a ready initialized document in 6,941 ms. The repeated request returned the same process, the coordinator retained its original binding, and the fixture journal accepted a delegate bound to the worker. Rhino's command history showed automatic `HopperCode` startup and its running confirmation; no competing browser tab appeared.

The new process loaded the rebuilt installed `Hopper.Rhino.rhp` and `Hopper.Core.dll`. Their SHA-256 hashes were respectively `7d8c98ba3d95529c795173455fa63956fd131cfc63d65eaa8b7b8b50616a413a` and `4f3c6b6e33c1c7f8d8b6189d66cb13e39e7dc6bb90a7e08a9c03e61c1feae5ea`. Both test processes were closed normally without save/discard commands. Original installed binaries were restored from backups and their hashes verified; the pre-existing Rhino remained open. Local reports are retained under `.tmp/windows-launch/live-1` and `.tmp/windows-launch/live-2`.

To reproduce after building and installing the updated native plugin:

```powershell
node scripts/windows-rhino-launch-smoke.mjs --allow-new-test-document --source-pid <connected-Rhino-PID> --output <new-empty-directory>
```

This verifies real launch, automatic attachment, readiness, duplicate-request handling, and delegation admission. Full model-driven delegated geometry execution, fresh-install prompts, and Windows lifetime/transfer acceptance remain separate checks.

## Historical Mac evidence

Recorded on 2026-09-09, Asia/Hong_Kong. This records observed behavior separately from tests with injected adapters.

## Control and startup implementation

`src/host/shared/control.ts` keeps `control.json`, discovery, and the browser credential in `~/.hopper/shared-control`, independently of the conversation data directory. A short-lived exclusive loopback listener serializes changes to this directory. Its port derives from the fixed control path. A collision with another owner's control listener blocks startup and never changes the assigned host endpoint. The first startup assigns and persists one loopback host port. The long-lived HTTP server holds that port exclusively; competing hosts cannot select fallback ports. An occupied endpoint with no matching healthy discovery is a manual recovery condition.

Control state pins the canonical data directory and the actual SQLite journal identity in `journal.sqlite`. Replacement startup rejects a missing directory, missing database, changed directory alias, or changed journal identity. An explicit conflicting data directory cannot create another journal. The browser credential persists across ordinary host restarts. Stop uses a compare-and-swap revision; only an explicit start changes stopped intent back to running.

POSIX directories use mode 0700 and files use 0600. Windows invokes `icacls.exe` to remove inherited access and grant the current account access. Windows ACL behavior still needs a packaged Windows check. The control listener and detached child behavior also need the Windows lifetime suite.

`ensure-host.ts` is the short-lived native launcher. It reuses matching HTTP health and discovery, or spawns Node with structured arguments, `detached: true`, ignored stdin, and an independently opened private log. It does not inherit Rhino's stdout/stderr pipes. It refuses occupied unhealthy endpoints, checks desired-state revisions while waiting, and never terminates an existing owner.

Focused tests cover simultaneous initialization, persistent identity, missing storage, stale revisions, exclusive lifetime binding, unhealthy endpoint conflicts, repeated launch admission, cancellation races, bootstrap correlation, and uncertain launch replay prevention. These are host tests, not packaged Rhino acceptance results.

## Mac process launch observation

The installed application reports Rhino version 8.34 and executable `Rhinoceros` in its Info.plist. No Rhinoceros process was present before the probe.

| Action | Observed result |
| --- | --- |
| `open -na '/Applications/Rhino 8.app'` | Started PID 66164 at 00:27:15. |
| Repeat `open -na` | Did not produce a second Rhinoceros process. |
| Spawn `/Applications/Rhino 8.app/Contents/MacOS/Rhinoceros` directly with structured arguments and detached stdio | Started PID 68940 at 00:28:50. |
| Inspect at 00:29:23 | Both PIDs remained alive, each with its own RhinoMonitor process. |

The two Rhino processes were left open. The probe did not edit or close any model. It establishes that a direct executable launch can create a second independent process on this installed build. It does not establish successful licensing, Hopper bootstrap, document readiness, UI-thread routing, sleep/wake behavior, or geometry fidelity. LaunchServices `open -na` must not be treated as sufficient evidence of an additional independent process on this build.

## Remaining native gates

The launch service persists launch state in the task SQLite journal and passes only an opaque ticket reference to the platform adapter. Private bootstrap ticket files hold the single-use nonce and request scope. Registration verifies that nonce, installation, PID/start identity, lifecycle compatibility, expiry, task authority, and current desired-state revision. Cancellation prevents registration from granting document authority. Unknown dispatch outcomes do not replay.

`NativeRhinoLaunchAdapter` requires explicit installation capability evidence. Its production capability flags must remain disabled until the packaged bootstrap command and document readiness have passed on the installation. The direct Mac process result above alone does not enable bootstrap. At the time of that initial process observation, Windows first-process/bootstrap checks, Mac authenticated bootstrap/readiness, sleep/wake, native document routing, and `.3dm` round trips still required platform acceptance checks. The later Mac results below supersede those initial unknowns. Windows and sleep/wake remain untested here.

A subsequent `rhinocode list --json` probe found only `rhinocode_remotepipe_66164`, reported build `8.34.26223.11002`, and an active document with empty title/location. The second OS process was not returned by this CLI discovery result. It therefore remains an independent-process candidate, not a verified ready Hopper target.

At 00:33, neither Rhinoceros process remained in the OS process list. Neither implementation agent closed or killed them. The cause was not established, so the earlier observation must not be used as proof of sustained ready application lifetime.

## Revised Mac scope

The user subsequently specified one Rhino process on Mac, with additional targets created by Rhino's New command as document windows in that process. The coordinator therefore rejects additional Mac process grants and routes an explicitly chosen lifecycle to a bounded `new` document grant. Those documents share the lifecycle's process edit queue. First-process launch remains part of native acceptance. Additional independent Mac process support is no longer a delivery requirement; the earlier process observations are retained only as test history.

## Packaged Mac smoke after the scope change

A fresh Release package was built at `/tmp/hopper-shared-native-smoke-20260909`. Package verification checked 12,069 files, 107.2 MiB. `scripts/smoke-staged-host.mjs` loaded the staged host modules, native ZeroMQ, SQLite journal, and esbuild using external Node 26.8.1.

The installed 0.1.90 package was backed up to `/tmp/hopper-installed-backup-20260909` before the staged build replaced it for testing. One Rhino process, PID 90188, started and reached the licensed template chooser. The default New Model action created an empty Untitled document. `rhinocode list --json` discovered that exact PID and pipe. No license settings or account credentials were changed.

A targeted vendor CLI `_New` command subsequently created a second document window in PID 90188. A RhinoCommon inspection script recorded document serials 268435457 and 268435458, with the second active and both `Modified=false`. The original document remained open. This establishes native same-process New behavior on this build; host routing and transaction checks require their separate smoke checks.

The first shared attachment attempt exposed a real startup admission cycle: Node waited for document inventory while C# waited for registration before enabling ordinary operation dispatch. Returning an authenticated recovering attachment before background inventory resolved it. The installed plugin subsequently reached ready state with both test documents captured in the journal.

After a fresh inspection confirmed only those two unmodified test documents, normal Rhino Quit ended PID 90188. The shared Node host remained healthy with the same epoch and endpoint. A new, explicitly authorized SQLite launch fixture then spawned the sole Rhino process with the structured argument `-runscript=_HopperBootstrap <opaque-ticket-reference>`. PID 3702 executed the bootstrap command automatically and authenticated its launch ticket, lifecycle, and PID/start identity. The startup argument therefore reached the packaged command successfully on this installed build.

The first readiness observation exposed another integration issue: sequential inventory polling used the generic 120-second RPC timeout on the exited attachment, delaying inventory of the new process. The new launch correctly remained awaiting document verification rather than receiving premature edit authority. Readiness polling now uses bounded per-attachment queries, skips verified exited processes, and progresses independently across attachments. The final first-launch fixture passed without the stale-process delay.

## Reproduce the packaged Mac document and transfer fixture

Build the release host and native package, install that package using the existing installer, and close Rhino normally after saving any work. Stop the shared Node host so the probe can acquire its existing endpoint. The probe refuses an occupied endpoint. Once it prints its connection prompt, manually open Rhino with an empty document and run `HopperCode`. It uses that document and creates a second test document, records real task/action/operation state in the pinned SQLite journal, and makes no model API calls.

```sh
pnpm exec tsc -p tsconfig.release.json
node scripts/shared-host-native-smoke.mjs \
  --allow-new-test-documents \
  --package-directory '/path/to/installed/hopper-package' \
  --output '/private/path/to/native-acceptance-results' \
  --hold
```

The fixture checks the loaded Rhino/Core package paths and writes a transfer report after same-process New, managed source/destination activation, and the `.3dm` checks pass. It does not start Rhino or publish launch capability tickets.

Use a new empty output directory for each run. The fixture checks a 1,000 mm sphere transferred into a meter document becomes a one-meter sphere, source geometry and document path remain intact, destination IDs are new, provenance points to the source ID, the imported object uses its dedicated layer, and published bytes match the manifest checksum. It then saves both documents through the production managed Save As path, including destination reservations and path/unmodified-state verification. It leaves those saved test documents open for inspection and never closes documents or discards modifications. `--hold` keeps the temporary host available until SIGTERM; omit it to release the endpoint when the checks finish. Restart the regular shared host after the probe exits. Retain the output report and artifact for review.

The first full native transfer run authenticated a fresh launch in roughly five seconds, granted a second document, switched the captured document under the process lease, created the source sphere, changed destination units, and exported `.3dm`. Import exposed a RhinoCommon Mac SDK defect: `File3dmObjectTable.Count` was one and direct enumeration returned the valid Brep, while LINQ `ToArray()` returned an array containing a null entry. A read-only vendor CLI probe and an owned, canceled diagnostic import established the exact failing predicate. Import now materializes the native table through explicit enumeration and rejects missing entries. The failed import canceled its own segment and retained its journal result; it did not claim success.

A later startup encountered Rhino's autosave recovery dialog. The pending launch was canceled before recovering the content. The recovered model contained exactly the prior test sphere; native Save As preserved it to the private fixture output and normal Quit ended the process. No autosave was discarded. This also exercised the need for explicit durable reconciliation after a canceled dispatch with no authenticated candidate identity. The reusable fixture now refuses a restored, modified, saved, or nonempty initial document and never edits that content.


## Final packaged Mac acceptance result

The complete repository fixture passed on Rhino `8.34.26223.11002`, using the installed packaged Rhino/Core binaries identified in [the retained acceptance summary](shared-host-native-smoke-result.json). The run used a real pinned journal, authenticated bootstrap, one Rhino process, and two document windows. It made no model API calls.

- Launch task `26339b4d-514f-487f-b748-45ddd47a30f5` completed with its verified initial document grant.
- Same-process New created the destination through a bounded document grant.
- Managed activation routed source/destination work under the process lease.
- Artifact `artifact-5d8ff2cc9d3115f4b1d32c2409a88e11` imported with a fresh destination object ID, recorded source provenance, dedicated layer, and verified SHA-256.
- The source sphere remained 1,000 mm with its original ID and unsaved path. The destination sphere measured one meter. Both checks ran against the native documents after import.
- Both documents then passed production managed Save As with destination reservations, updated paths, and `isModified=false`. Cocoa displayed the saved document title and URL.
- The same native lifecycle reattached across replacement fixture hosts during the separate save diagnosis. Stale exited attachment records no longer block destination checks.
- A canceled launch with no authenticated candidate was reconciled through the public coordinator recovery API after explicit inspection and an empty native-process snapshot. Its canceled record remained intact.

The full report, manifests, `.3dm` artifact, saved source/destination models, and binary-bound capability evidence remain in `/tmp/hopper-shared-native-final-pass-20260909`. The capability reader reported `bootstrapVerified=true` for those installed test binaries. After verifying the two documents were saved and contained only the expected fixture objects, their windows were closed normally and Rhino quit. The original installed plugin package was restored from the independent backup; the tested package was retained separately. Restoring the original binaries invalidates the test capability evidence by hash.

Windows packaged behavior, Windows ACL/lifetime acceptance, and sleep/wake were not executed on this Mac. Additional independent Mac processes are outside the user's revised scope.
