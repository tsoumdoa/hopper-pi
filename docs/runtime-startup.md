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

The follow-up below also consolidates Pi coding-agent's public SDK entry.
Pi AI, native bindings, and original worker/asset files retain their layouts.

## Initial dependency-bundling measurements

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

## Windows follow-up: consolidate the Pi SDK

The packaging pipeline now bundles Pi coding-agent 0.85.1's 193-module SDK
graph into one file before pruning, in addition to the TypeBox and agent-core
bundles above. The original public entry re-exports that bundle. Source-relative
`import.meta.url` values are reconstructed relative to the relocated bundle,
preserving extension resolution, workers, themes, and assets. Original Pi files
remain for CLI/RPC compatibility. No browser startup gate or delay is introduced.

Packaging replaces staged entry files instead of writing through pnpm hardlinks,
including the pre-existing SDK deduplication wrappers. Version/layout checks
reject unsupported packages. Relocation and shared-file regression tests cover
these changes. A comparison of the real original and bundled SDK found all 151
public exports unchanged; the staged smoke also exercises `pi.resizeImage`
through the consolidated SDK, in addition to the original worker path.

Measured on Windows x64 / Node 22.22.3 on 2026-09-11. The baseline is PR #104 at
`5230a6c`, not the original unoptimized release. Each host measurement uses five
fresh direct-start processes with isolated empty home/data directories and
uncontrolled warm filesystem caches. No launcher/browser handshake is simulated.

| Median measurement | #104 baseline | With SDK bundling |
| --- | ---: | ---: |
| Host runtime-module stage | 553 ms | 446 ms |
| First health response | 833 ms | 730 ms |
| Host ready, including process startup | 945 ms | 825 ms |
| Standalone SDK import | 538 ms | 444 ms |
| SDK files loaded | 763 | 572 |
| SDK resolution calls | 2,486 | 1,612 |

Host timings are from the clean Windows package. Standalone import timings and
counts are from a copy of the baseline stage with only the SDK bundler applied.
The experiment's first host launch took 4,190 ms, while subsequent runs took
798–801 ms. Do not interpret warmed medians as a cold-launch guarantee.

Real Rhino host logs on this machine show recent runtime import stages of
6,355–9,940 ms, followed by about 310–362 ms of agent initialization. Even the
installed package benchmarks below one second with isolated warm launches. That
gap was not explained by those benchmarks: these measurements do not establish a new in-Rhino
launch time. Startup logs now include the Node executable, version, and process
age to help compare the real launch environment with the benchmark. Further work
should reproduce the slow Rhino launch and correlate import timing with process
and filesystem activity before choosing another optimization.

Reproduce using the exact Node executable reported in the real host log:

```sh
node scripts/benchmark-host-startup.mjs --entry artifacts/pr104-sdk-win/runtime/host/dist/host/index.js --runs 5 --output artifacts/startup-report.json
node scripts/profile-runtime-imports.mjs artifacts/pr104-sdk-win/runtime/host --runs 5
```

The benchmark supports `--node <absolute executable>` and records stage times,
first health response, and readiness. It verifies child ownership and isolates
home, control, credentials, data, and workspace; it never uses the live journal.
It does not launch Rhino or measure browser rendering or model response time.

Validation on Windows: 419 Vitest tests passed / one skipped, two benchmark
tests passed, host/web TypeScript checks passed, 142 .NET tests passed, and the
cross-language RPC smoke passed. Existing asset-path and shutdown-handler tests
were made portable on Windows. Clean Windows and macOS arm64 Yak packages passed
verification and unchanged size budgets. Payloads are 85,855,616 and 82,698,009
bytes respectively; retaining the original Pi files adds approximately 0.8 MiB
over the initial #104 packages. Windows native runtime smoke passed sessions,
typed extensions, shared SDK/schema/agent identity, providers, native bindings,
image workers/WASM, SQLite, and esbuild. This follow-up has not been executed
natively on macOS or accepted manually in Rhino/browser.

## Fresh-package file reads and deferred HTTP client

A subsequent real installed launch still spent 5,410 ms in imports and reached
host readiness at 5,835 ms. A traced warm launch through Rhino with the same
installed package and existing Hopper data reached readiness in 639 ms.
Launching a fresh copy of the package through Rhino reproduced 3,712 ms to
readiness, including about 1,010 ms in synchronous file reads during imports.
The warm trace spent only about 17 ms in those reads. This reproduces a large
first-use file-loading cost; it does not establish whether storage, caching, or
security scanning is responsible, nor prove that every repeated launch is fast.

Pi's SettingsManager imports HTTP timeout constants from a module that eagerly
imports Undici. Hopper's embedded startup does not configure Pi's CLI dispatcher.
The staged SDK bundler now defers that dependency until the dispatcher actually
uses it, retaining the synchronous configuration API, proxy/timeouts, error
listeners, and fetch override behavior. A SHA-256 check against the audited Pi
0.85.1 dispatcher source stops packaging if upstream code changes. The original
Pi files and Undici remain installed for CLI and extension compatibility.

This removes 108 loaded modules: the SDK import graph falls from 572 to 464 files
and from 1,612 to 1,182 resolutions. Five isolated warm Windows host runs give
medians of 409 ms for runtime imports, 687 ms for first health, and 794 ms for
readiness. Standalone SDK import median was 436 ms.

A fresh-copy Rhino launch with this change reached readiness in 3,448 ms, with
about 452 ms in synchronous import-time file reads and 875 ms total process CPU
reported at readiness. The 3,712 → 3,448 ms comparison is one launch per fresh
directory, with uncontrolled filesystem caches and temporary tracing. It is not
a reliable cold-start percentile or a browser-render measurement. Both used
Rhino `/notemplate` and the existing Hopper journal. No geometry/model work ran.

Normal startup stage logs now include cumulative CPU time alongside elapsed
time, without installing module hooks. Future slow-launch reports can distinguish
CPU work from elapsed waits. Temporary tracing was confined to test-launched
Rhino processes and is not part of normal launch configuration.

Validation: 421 Vitest tests passed / one skipped, two benchmark tests passed,
host/web TypeScript checks passed, Windows staged runtime smoke passed, and
Windows/macOS Yak packaging passed unchanged budgets. New regressions verify
that reading settings does not load Undici, unsupported source is rejected,
dispatcher settings/error handling are preserved, and the real deferred client
successfully completes a loopback HTTP request in an isolated child process.

After installing this candidate through the normal Windows installer, an
untraced first Rhino launch reached host readiness at 4,961 ms (1,047 ms CPU;
the Node process was already 126 ms old at the first stage). Immediately closing
and reopening the test Rhino instance reached readiness at 588 ms, with the
runtime import stage taking 391 ms. Both used the installed package, the existing
journal, and `/notemplate`, without tracing or a host-entry override. These
observations confirm a substantial first-use versus repeat-launch difference on
this machine. The first installed launch is still about five seconds; this change
does not solve that remaining delay or establish reboot-cold/browser-render times.

## Startup source archive: reducing first-use reads

The packaged host now reads selected startup dependency sources from one gzip
archive, `node_modules/.hopper-startup-sources.json.gz`. This addresses the file
reads left after bundling. It contains the original JavaScript sources and their
module formats; it does not combine their execution or change the import graph.

The host opens its browser server before asynchronously reading and decompressing
the archive. A temporary [Node synchronous load hook](https://nodejs.org/api/module.html#moduleregisterhooksoptions)
supplies those sources at their original file URLs. Node still resolves imports
and maintains its ESM/CommonJS caches. Native binaries, JSON, assets, workers,
and any source outside the archive use the normal filesystem loader. The hook
is removed and its source table cleared after agent initialization, including on
startup failure. Missing or invalid archives fall back to ordinary file loads.
Development installs do not contain an archive.

`scripts/pack-startup-sources.mjs` runs after all staged dependency rewrites and
pruning. Its package list follows the observed startup graph and controls size;
unlisted dependencies remain importable. The Windows archive contains 956 source
files in 2,224,035 compressed bytes. Original dependency files remain installed,
so extensions and later imports keep their existing paths. This is a deliberate
2.2 MB package-size tradeoff for fewer startup reads. Existing size limits stay
unchanged: the Windows stage is 88,081,453 bytes and macOS arm64 is 84,920,398.

Measured on the same Windows x64 / Node 22.22.3 machine on 2026-09-11. The initial
comparison launched Rhino in baseline/candidate/candidate/baseline order, each
from a newly copied package path with `/notemplate` and the existing journal.
The installed native plugin launched each candidate using `HOPPER_HOST_ENTRY`.
No import tracing, geometry, or model requests were added.

| Real Rhino launch measurement | Previous #104 package | Source archive |
| --- | ---: | ---: |
| Host readiness, fresh path run 1 | 5,162 ms | 1,152 ms |
| Host readiness, fresh path run 2 | 3,009 ms | 1,138 ms |
| Process age before the host stage timer | 124 / 102 ms | 110 / 101 ms |
| Runtime-module stage | 4,812 / 2,693 ms | 896 / 894 ms |
| CPU consumed by readiness | 875 / 953 ms | 860 / 938 ms |

These are small-sample first-use measurements with uncontrolled OS caches, not
reboot-cold percentiles or browser-render times. One further baseline attempt
never reached Hopper's startup log and timed out; it provides no host-startup
timing. A subsequent pair reached 3,296 / 1,222 ms, but overlapped an isolated
benchmark and is excluded from the comparison above.

The normal Windows installer then built, verified, smoke-tested, and installed
the candidate through Yak. The first untraced Rhino launch, with no host-entry
override, reached readiness in **1,647 ms**, versus the previously recorded
**4,961 ms** first installed launch. Including the Node process age before the
stage timer gives 1,774 ms for the new launch. This is a measured improvement of
about 67% in the reported host-readiness interval, not a guarantee for every
future first launch.

The immediate installed repeat reached readiness in **650 ms**, versus the
earlier **588 ms** repeat. The archive adds a decompression and parsing cost even
with warm filesystem caches; the observed repeat was 62 ms slower. The primary
benefit is reducing the multi-second first-use delay. Neither pair measures a
reboot-cold launch or the complete Rhino/browser startup.

The direct host benchmark now accepts `--copy-root` to copy the complete host
tree to a new temporary path before **each** launch. Copying is excluded from
timing. Home, credentials, control state, data, and workspace remain isolated.
This reproduces first-use package paths without replacing the live installation:

```sh
node scripts/benchmark-host-startup.mjs --entry artifacts/pr104-source-pack-win/runtime/host/dist/host/index.js --copy-root artifacts/pr104-source-pack-win/runtime/host --runs 3 --output artifacts/fresh-startup-report.json
```

Validation: 427 Vitest tests passed / one skipped, all three benchmark tests
passed, and host/web TypeScript checks passed. Source-archive regressions use
real child Node processes to verify ESM live bindings and identity, CJS cycles,
`require.cache`, asset reads, workers, Windows short paths, relocation through
spaces and Unicode, cleanup, and missing/corrupt archive fallback. Packaging
rejects linked inputs and refuses to overwrite an existing archive. Windows
staged smoke passed with the archive active for sessions, typed extensions,
providers, native bindings, credential fixtures, image workers/WASM, SQLite,
and esbuild. Clean Windows and macOS Yak builds passed verification and existing
budgets; native macOS execution was not available.

## Defer the TypeScript extension compiler

A follow-up investigation found that Pi's extension loader statically imports
`jiti/static`, which evaluates about 1.7 MB of compiler code. Hopper supplies
compiled extension factories with `noExtensions: true`, so its normal startup
does not need that compiler. The staged SDK bundler now moves the Jiti import
into the existing asynchronous extension-file loader, after its factory-cache
check. A SHA-256 check against the audited Pi 0.85.1 source rejects upstream
changes before rewriting the SDK. Loading a TypeScript extension still uses
the same Jiti implementation, aliases, options, and error handling.

Jiti remains installed and is omitted from the startup archive. The Windows
archive falls from 2,224,035 to **1,801,111 bytes**, with 947 source files. This
reduces both compiler evaluation and archive preparation during startup.

The investigation compared the preceding archive with an equivalent lazy-Jiti
prototype in isolated Node 22.22.3 children. Host tests used three fresh-path
pairs, alternating order, with one immediate repeat per path. Import-only tests
used eight alternating pairs after discarding an initial warmup pair.

| Median measurement | Source archive | With lazy Jiti |
| --- | ---: | ---: |
| Warm import probe, including archive preparation | 442 ms | 355 ms |
| Direct host readiness, fresh package path | 1,385 ms | 1,312 ms |
| Direct host runtime-module stage, fresh path | 803 ms | 717 ms |
| Direct host readiness, immediate repeat | 809 ms | 731 ms |
| Direct host runtime-module stage, repeat | 431 ms | 348 ms |

These are direct host measurements with empty isolated data and uncontrolled
OS caches, not new installed Rhino measurements. The 1,647 / 650 ms installed
Rhino pair above belongs to the preceding source-archive implementation.
Alternative compression with Brotli showed no meaningful timing improvement.
Pruning the archive to the import probe's observed modules saved about 25 ms,
but was not adopted because the probe does not cover every initialization path.

The regression test imports the real bundled SDK in an isolated Node process,
checks that SDK imports and inline extension factories leave Jiti unloaded,
then loads a real TypeScript extension through the SDK's public
`discoverAndLoadExtensions()` API. It checks shared schema identity, repeated
loads, and missing-file errors. Staged smoke now checks this public bundled
path as well as the original deep extension loader.

Validation of the final implementation: 429 Vitest tests passed / one skipped
with two workers, and host/web TypeScript checks passed. The first concurrent
build/test run hit an existing five-second bundler-test timeout and a shutdown
test's exit-event race; the bounded-worker suite passed without changing those
tests. Windows staged smoke passed, including the on-demand compiler checks.
Clean Windows and macOS arm64 Yak builds passed unchanged size budgets at
87,658,528 and 84,498,262 staged bytes respectively. Native macOS execution of
this follow-up remains untested.
