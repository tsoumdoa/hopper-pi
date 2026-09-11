# Document and script integration verification

Document management and editable script assets shipped together in PR #89. Their current contracts are documented in [document management implementation](document-management-implementation.md) and [Rhino script workspace](rhino-script-workspace.md).

The agent can manage `.3dm`, `.gh`, and `.ghx` documents with `rh_document` and `gh_document`, including inspecting units and tolerances with `getSettings`. It can keep Python/C# source in `rh_script`, edit selected lines against a revision, and execute a pinned revision through `rh_run_script`. Existing inline scripts and command macros remain supported. Editing saved source does not replace geometry produced by earlier runs.

The native test project and its runner have been removed. The results here
record earlier verification, not runnable checks in the current checkout.
See [Testing](../TESTING.md) for current automated and manual checks.

## Checks completed on 2026-09-06

| Check | Result |
| --- | --- |
| Full Vitest suite | 464 tests across 52 files passed |
| Hopper.Core | 219 tests passed |
| Standalone Grasshopper test host | 69 tests passed; two native graph tests excluded and run inside Rhino instead |
| Native graph tests | Both passed inside Rhino |
| Cross-language RPC | Authenticated handshake, query, and mutation passed |
| TypeScript and release UI build | Passed, with Vite chunk-size warnings |
| Rhino and Grasshopper production builds | Both `net7.0` and `net7.0-windows` passed |
| Native document lifecycle | `DocumentManagementNativeTests.RunAll` passed |
| Native Python/C# execution | `RhinoScriptNativeTests.RunAll` passed |

Native checks ran on Rhino 8.34.26223.11002 for macOS. The document test covers visible new documents, Unicode paths, `.3dm`/`.gh`/`.ghx` round trips, templates, stale state, tolerance revisions, destination collisions, solver-disabled edits, external saves, and changes made from save callbacks. The script test runs Python and C#, rejects stale document/settings targets before execution, and verifies that one native Undo removes both scripts' geometry. Both tests restore the original document inventory and check that the original Rhino document's modified state is preserved.

The PR review follow-up adds native save callbacks that change notes, model basepoint, render DPI, and earth-anchor data. Each save-before-close reports `DOCUMENT_CHANGED`, keeps the model open, and marks it unsaved. An ordinary save clears the explicitly established AppKit edited state. Background GH path/save/Undo events preserve another definition's agent transaction, and cancel still restores that definition.

New Node regressions cover editable blank lines, continuation after long source lines, execution history longer than revision history, native execution preconditions without an extra Node query, and closing the RPC transport when uncertainty prevents cancellation. The duplicate `expectedSettingsRevision` field was removed; callers use `expectedDocument.settingsRevision`. The review also removed duplicate activation/effect reporting and condensed the completed plans. Workspace-wide replay identity and execution recovery remain intact.

Storage, pinned asset execution, replay, concurrency, restart recovery, and uncertain-result handling have automated Node coverage. The native script test invokes the shared executor directly; it does not constitute an end-to-end UI test of asset creation through execution.

## Historical native verification

### Language warmup regression, 2026-09-07

The session trace located the first-run Python and C# failures in `WaitForLanguage`, after `WaitStatusComplete` and inside `WaitLoadComplete`. The installed Rhino assembly confirms that `WaitStatusComplete(LanguageSpec)` already invokes loaders with a default responder and waits for readiness. The subsequent `WaitLoadComplete(spec, null)` unconditionally dereferences its reporter, even when no loaders remain. The fix removes that redundant call and reports an explicit error if the status-wait method is unavailable. The same null-reporter call remains in `origin/main` at `72049f7`; it was not introduced by the host split.

All 18 focused warmup, diagnostics, and adapter tests passed, including language-spec fallback when static properties are absent. The adversarial review removed the separate preload coordinator and readiness cache. Preload and script execution now share `WarmedModes` and recheck the registry. The native test calls the production preload entry point, including a reentrant callback and a repeat call, then verifies Python/C# execution, intentional Python failure output, document/settings guards, Undo, and document preservation.

`RhinoScriptNativeTests.RunAll` passed with isolated rebuilt assemblies and a disposable document. With both runtimes already loaded, initial preload checks took 1.7508 ms and the repeat with registry revalidation took 0.1942 ms. These are warm-runtime measurements. The test writes `preload-timing.json` beside its isolated assembly. Those runs did not exercise cold startup because the C# test bootstrap loads scripting assemblies. No installed plugin was replaced by these tests.

The review follow-up adds runtime bootstrap through `PlugIn.LoadPlugIn` before type resolution, shared by preload and script execution. Readiness now checks `ILanguage.Status.IsReady` and rejects errored status before caching a mode. Initialization failures include Rhino's progress message and diagnostics. The installed Rhino implementation exposes `Status` explicitly through `ILanguage`; the regression fixture uses the same interface pattern.

All 23 focused .NET warmup, diagnostics, and adapter tests passed after these fixes. They cover missing runtime types, plugin-load failure, post-load type revalidation, completed-but-errored initialization, retry after failure, and a cached language becoming errored. Both production targets, `net7.0` and `net7.0-windows`, built without warnings. `RhinoScriptNativeTests.RunAll` passed again on macOS Rhino 8.34.26223.11002 with isolated assemblies and a disposable document. Fully cold Rhino startup remains unverified; bootstrap unit tests simulate absent assemblies, and the native launcher itself uses C#.

The macOS verification above did not install a built plugin or validate Windows. Its restart, host-crash durability, and broader native cases listed in [document management implementation](document-management-implementation.md) were left as release checks; the focused Windows results below are not full release certification.

## Host lifecycle and package release checklist

Use a controlled Rhino profile with Grasshopper configured to load on demand. Record the Rhino version, operating system, package revision, and results for each native target. These are release checks, not claims of completed verification; the focused results elsewhere in this document do not establish a full pass.

- Install the Yak on macOS arm64 and Windows x64, resolve external stable Node 22.19.0 or newer, and verify native ZeroMQ imports. The package must contain no bundled Node executable or native binaries for another target.
- Confirm `HopperCode` starts without loading Grasshopper or `Hopper.Grasshopper`; the first Grasshopper tool starts it once, waits for readiness, and requires an active definition.
- Confirm `running` requires an authenticated Node-to-Rhino handshake. Repeated start, stop, and restart commands must leave only one transport and one child. Running `HopperCode` while already running must reopen the current conversation.
- Run one Rhino and one Grasshopper operation from each installed package. A query after a mutation must observe the completed mutation, and a lost reply must be recovered without resubmitting it.
- Confirm stop, restart, and host loss clean queued work and open transactions without blocking Rhino's UI. Restart must wait until the old child and transport have stopped.
- Confirm abrupt Rhino exit leaves no child after three seconds, and Node exit or three consecutive failed health checks produces a visible `faulted` state in `HopperCodeStatus`.
- Confirm Rhino and Grasshopper document events update runtime status, including active-document and canvas changes.

## Windows loading regression fixes

On Rhino 8.33.26188.13001 for Windows, `DocumentLoadingNativeTests` passed open and template rejection checks for a text-only `.3dm` fixture and a GHX fixture containing one unknown top-level component GUID. Valid `.gh` and `.ghx` lifecycle round trips also passed. Completion establishes that these fixtures did not block on a modal dialog; the tests do not inspect dialogs or cover all corrupt files, nested missing components, or third-party deserializers. These checks used the former native runner with Grasshopper loaded and an idle Rhino command line.

The script-execution regression passes saved revisions through the production backend and validates the actual RPC envelope, ensuring omitted `echo` values remain omitted instead of becoming `undefined` JSON properties. This fix is platform-independent. The Grasshopper archive loader is shared by both platforms; macOS runtime revalidation is still required. The invalid-Rhino-file preflight applies to the Windows replacement path; the existing macOS document-window implementation is unchanged.

Windows validation after these fixes: 17 script-execution tests and the three native entry points pass; TypeScript checking and both Windows production builds pass. Broader suites retain six unrelated Windows path-fixture failures (four host-config expectations and two fake-filesystem profile-scanner tests); these do not exercise the changed paths.

The September 7 review follow-up rebuilt the native test assembly and reran all three entry points successfully on the same Windows Rhino version. The missing-component check now requires its specific error code and fixture GUID; the round-trip harness calls its helper directly and restores the original Grasshopper inventory and active document in `finally`.
