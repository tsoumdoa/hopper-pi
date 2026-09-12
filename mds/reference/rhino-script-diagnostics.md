# Rhino script runtime diagnostics

Use when Python or C# fails during initialization or on its first run. Source and execution formats are in [Rhino scripting](./rhino-script-boilerplate.md).

`HopperCode` and `HopperCodeRestart` preload both languages on Rhino's UI thread. If scripting assemblies are absent, Hopper loads Rhino's scripting plugin before resolving runtime types. Preload and script execution share readiness checks. Failed languages are retried on later calls; failure in one language does not prevent the other from initializing or Hopper from opening.

Inspect the failed run's stages, elapsed times, exceptions, partial output, and captured loading messages. Language lookup alone does not prove readiness, and `code-run` can include initialization and compilation. Native stack frames are not user-source line numbers.

For a first-run investigation, export the session after the first failure and retain the exact source and diagnostics. Compare the same source after the runtime has loaded, using a disposable document if the script changes geometry or layers. Inspect for partial changes before rerunning a mutation. For uncertain saved-script runs, use `getRun` and `reconcileRun` first; reconciliation does not execute source again.

A successful run after the runtime has loaded does not verify cold startup. A C# test launcher can itself load the scripting assemblies, so report whether the runtime was already initialized when describing a reproduction.
