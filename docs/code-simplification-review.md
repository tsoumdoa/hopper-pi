Adversarial code review, September 5, 2026

The review found one incorrect failure-reporting path and several removable remnants of the RPC and Rhino ownership migrations. The working tree includes the fixes below. Production source is about 490 lines smaller, excluding tests and compiler configuration.

| Priority | Finding and evidence | Change |
| --- | --- | --- |
| P1 | `src/tools/execute-factory.ts` called the success formatter after `submitCommand` threw. Several formatters then emitted `completed` with a fabricated `failed: ...` job ID. | Use the existing error formatter once. Only successful edits call the success formatter. Unknown mutation outcomes retain their inspection and no-retry guidance. |
| P2 | `src/infra/subscriber.ts` had no importers. Its job/XML messages and `src/types/job.ts` belonged to the old transport. The current runtime uses `SubscriberStatusEventSource`. | Remove the orphaned subscriber, job model, and obsolete job, ping, and authentication message types. |
| P2 | Grasshopper still declared unused Rhino response DTOs after Rhino operations moved into `Hopper.Rhino`. Obsolete job envelopes and an unused graph endpoint class also remained. | Remove the unused declarations. Active Rhino contracts, Grasshopper responses, and RPC v2 contracts remain. |
| P2 | `RhinoCodeRunner.ScheduleWarmup` had no callers, and its `WarmupLanguage` helper was only used by that method. `SystemMutationResultStoreClock` was also never instantiated. | Remove the dead scheduler, helper, and clock implementation. The script runner still calls `EnsureLanguageReady` when needed. |
| P2 | Canvas exclusions repeatedly scanned an undirected graph even though every newly excluded node had only already-excluded neighbors. Selected-group expansion repeatedly rescanned previously visited groups. | Calculate exclusions in one pass. Iterate the expanding selection set once, which visits newly added members and terminates on group cycles. Remove the unused component argument. |
| P2 | Component search checked per-word prefixes and substrings after a whole-name substring match had already returned. Those ranking branches could never execute. | Remove the unreachable branches and redundant minimum-length checks. Preserve the scores reachable by existing inputs. |
| P3 | `withRequester` used `try/finally` solely to call an empty `close()` method. Two deprecated import barrels added indirection, and `probeOnce` only forwarded a call. | Remove the empty cleanup and forwarding function. Update callers to import directly from the defining modules and delete the deprecated barrels. |
| P3 | Unused debug flags, an option constant, a script formatter, and superseded command types remained exported. | Remove them and enable `noUnusedLocals` and `noUnusedParameters` in both TypeScript projects. |

Verification used compiler unused-code diagnostics, a TypeScript import graph, repository-wide symbol searches, caller inspection, builds, and tests. Plugin commands and Grasshopper loader entry points are discovered by their host, so an absent source reference alone was not treated as proof that they were dead. Cross-language protocol definitions and lifecycle recovery paths were retained.

| Check | Result |
| --- | --- |
| `pnpm test` | 331 tests passed across 43 files. |
| `pnpm build` | Passed with unused-code checks enabled. |
| `pnpm build:release` | Passed, including the browser production bundle. |
| `dotnet test dotnet/Hopper.Core.Tests/Hopper.Core.Tests.csproj --no-restore --verbosity quiet` | 205 passed. |
| `dotnet build grasshopper-plugin.Tests/grasshopper-plugin.Tests.csproj --no-restore --verbosity quiet` | Passed. Four platform analyzer warnings concern existing drawing calls in `PluginIcon.cs` and `GraphObjectFactory.cs`. |
| `dotnet test grasshopper-plugin.Tests/grasshopper-plugin.Tests.csproj --no-restore --verbosity quiet` | 69 passed; two graph execution tests failed to load the Grasshopper assembly. |
| `pnpm test:rpc-cross-language` | Passed authenticated handshake, query, and mutation exchange between C# and TypeScript. |
| `git diff --check` | Passed. |

Regression coverage now checks that failed and unknown-outcome edits never receive success text. Canvas tests cover actual exclusions, retained neighbors, self-connections, wire ordering, nested groups, cyclic membership, and removal of external wires.

The two plugin failures are `Multi_wire_graph_runs_one_solution` and `Invalid_port_after_creation_rolls_back_to_byte_equal_snapshot`. Both throw `FileNotFoundException` for `Grasshopper, Version=8.0.23304.9001` before exercising graph behavior. Live Rhino execution remains unverified in this test environment.

This review establishes that the removed code has no repository callers or is unreachable under the inspected control flow. It does not prove that every remaining path is necessary, and TypeScript's unused-code checks do not detect every unused export or file. External consumers importing internal source paths would need to follow the removed modules to their current replacements.
