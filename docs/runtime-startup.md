# Runtime dependency bundling

The shared host's "loading runtime modules" stage imports the Pi SDK before
opening the journal or creating the agent. In the original 0.1.90 package,
importing `@earendil-works/pi-coding-agent` loads 1,477 files on Node 26.8.1.
Many small module reads make startup sensitive to filesystem and antivirus
overhead. The reported Windows delay exceeds 10 seconds; its individual costs
have not been measured on a Windows machine.

`scripts/package-rhino.mjs` now runs `bundle-rhino-dependencies.mjs` after
installing and pruning production dependencies. It bundles TypeBox 1.3.7 and
Pi agent core 0.85.1 inside their staged package directories. Their public
entrypoint paths and package manifests stay the same. Shared chunks keep
schema registries, agent classes, and context objects identical across imports,
including imports made by Pi's TypeScript extension loader.

The bundler checks the audited versions and complete runtime export maps,
then builds every entrypoint before replacing either package's code tree.
Other packages remain external to these bundles. Licenses and package metadata
remain in place. Development installs and standalone builds are unchanged.

| Package | Build input modules | Bundled output files | Files loaded by SDK import, before → after |
| --- | ---: | ---: | ---: |
| TypeBox | 662 | 19 | 660 → 13 |
| Pi agent core | 87 | 16 | 76 → 9 |

Pi coding-agent and pi-ai remain in their original layouts. Their extension
loader, image worker, themes, exporter, and lazy provider imports depend on
package-relative paths. Native bindings also remain separate. Bundling those
packages requires a separate audit of those paths and module identity.

## Measurements

Measured on macOS arm64 on 2026-09-11, comparing the installed 0.1.90 release
with the new clean macOS stage. Times below are medians of seven fresh Node
processes importing the SDK, with warm OS file caches. They exclude Node
process launch, journal recovery, agent creation, and Rhino startup. Graph
instrumentation runs separately from the timing probes.

| Measurement | Before | After |
| --- | ---: | ---: |
| Node 26.8.1 SDK import | 279 ms | 210 ms |
| Node 26.8.1 loaded files | 1,477 | 763 |
| Node 26.8.1 resolution calls | 4,944 | 2,488 |
| Node 22.19.0 SDK import | 319 ms | 254 ms |
| Node 22.19.0 loaded files | 1,479 | 765 |
| Node 22.19.0 resolution calls | 5,066 | 2,610 |

The change removes 714 file loads and 2,456 resolution calls from SDK import.
Measured Mac import time improves by about 20–25%. Windows speedup remains
unmeasured; fewer imports do not establish a particular Windows launch time.

Clean package sizes remain within the existing budgets:

| Target | Staged bytes | Dependency bytes | Yak bytes | Staged files |
| --- | ---: | ---: | ---: | ---: |
| macOS arm64 | 81,874,676 | 56,519,286 | 37,055,618 | 5,724 |
| Windows x64 | 85,034,826 | 59,680,230 | 38,374,761 | 5,725 |

## Reproduce

Run this from the repository, pointing to an installed or staged host directory.
The script works with Windows paths as well:

```sh
node scripts/profile-runtime-imports.mjs artifacts/startup-mac/runtime/host --runs 7
```

It prints JSON with per-run wall and CPU time, Node version, platform,
architecture, file counts by package, resolution calls, and native load times.
Use `--module zeromq` to isolate another import or `HOPPER_NODE_EXECUTABLE` to
select the Node binary used by Rhino. Repeat runs warm filesystem caches;
these are not measurements of a cold boot. The graph probe's own elapsed time
includes instrumentation overhead and should not be used for comparisons.

## Validation

- 416 JavaScript tests and 142 .NET tests passed, along with TypeScript checks
  and the authenticated cross-language RPC smoke.
- Tests compare all public exports before and after bundling, check shared
  TypeBox format registration through interpreted and compiled validation,
  verify agent/context identity, and reject changed versions or exports before
  replacing files.
- Clean macOS and Windows Yak builds passed package, architecture, and size
  verification without increasing budgets.
- The staged macOS runtime smoke passed on Node 22.19.0 and 26.8.1, including
  real Pi/Hopper sessions, typed extensions, shared schema/agent imports,
  providers, temporary credential fixtures, ZeroMQ, image worker/WASM, SQLite,
  and esbuild.
- Windows native execution and manual in-Rhino testing were not available on
  this Mac. Run `node scripts/smoke-staged-host.mjs <stage>` on Windows before
  release acceptance.
