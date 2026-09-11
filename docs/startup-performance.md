# Measuring packaged host startup

Run the benchmark against a staged or installed package, using the same Node executable for before/after comparisons:

```powershell
node scripts/benchmark-host-startup.mjs --entry '<package>/runtime/host/dist/host/index.js' --runs 5 --output before.json
node scripts/benchmark-host-startup.mjs --entry '<updated-package>/runtime/host/dist/host/index.js' --runs 5 --output after.json
node scripts/benchmark-host-startup.mjs --entry '<updated-package>/runtime/host/dist/host/index.js' --runs 5 --browser-handshake --output browser.json
```

`--node <executable>` selects the child Node runtime. `--timeout-ms 60000` sets the per-run startup deadline. The packaged static directory must exist; the benchmark does not substitute a fake UI.

Each run starts one host directly in a fresh process with empty temporary data. It never invokes `--ensure-host`, opens a real browser, attaches to Rhino, sends a prompt, or discovers the user's running host. A preload redirects both `os.homedir()` and `os.userInfo().homedir` before host imports; the latter matters because shared control deliberately ignores `--data-dir`. The real username is retained so Windows ACL setup behaves normally. Auth, configuration, Pi home, workspace, and data paths are isolated, and provider credentials and Node/Hopper overrides are excluded from the child environment. The child is stopped and the temporary tree removed after each run, including failed runs.

The JSON report distinguishes:

| Field | Meaning |
| --- | --- |
| `listeningMs` | Process spawn to receipt of the first browser-listening stage log. The port can be listening while JavaScript blocks HTTP responses. |
| `firstHealthMs` | Process spawn to the first successful HTTP health response matching this child's PID and host epoch. |
| `loadingPageMs` | In handshake mode, process spawn to receipt of the static index page. |
| `browserAuthSentMs` | In handshake mode, process spawn to sending browser WebSocket authentication. This does not measure rendering or completion of authentication. |
| `readyMs` | Process spawn to health reporting runtime readiness. This does not measure the first model response or Rhino connection. |
| `runtimeModulesMs` | Difference between host stage timestamps for runtime imports and opening the journal. |
| `stages` | Each startup stage with both host-relative time and time observed by the parent. |

HTTP polling runs every 25 ms with a 250 ms request timeout. Process timings include Node startup, the isolation preload, and first-use control/ACL creation. There is no existing session history. They therefore help compare package changes but are not identical to reopening Hopper against an existing host.

`--browser-handshake` simulates the verified launcher acknowledgement and loading browser: request health, acknowledge the host epoch using the isolated registration credential, fetch the index, then authenticate a WebSocket. It exercises the packaged startup gate without creating a detached launcher process. It requires the updated host and the repository's `ws` dependency. It is a protocol benchmark, not a real browser render benchmark. Use normal mode for an older baseline package that lacks the handshake endpoint.

## Cache conditions and acceptance

Fresh processes are **not cold filesystem caches**. The benchmark does not clear caches, disable antivirus, or claim its first run represents a reboot. Measure true first-launch behavior separately after a reboot, record that condition with the report, and repeat on the same machine. Avoid building or otherwise reading the package immediately before that measurement. Windows antivirus and filesystem caching can substantially change first-launch import costs.

For the reported slow startup, acceptance should track both time before the browser opens and time until chat is usable. The proposed 1–2 second browser opening and sub-3-second cold readiness remain targets until measured on the affected machine. A fast loading page alone does not establish a fast runtime.

An initial Windows baseline using the installed 0.1.90 package and Node 22.22.3 (2026-09-11, cache uncontrolled) measured:

| Run | Listening | First health | Ready | Runtime modules |
| --- | ---: | ---: | ---: | ---: |
| 1 | 290 ms | 1052 ms | 1161 ms | 754 ms |
| 2 | 258 ms | 939 ms | 1027 ms | 673 ms |
| 3 | 253 ms | 921 ms | 1014 ms | 659 ms |

These warm observations do not reproduce or disprove the user's 10–13 second module-loading logs. They show the event-loop effect even when warm: HTTP first responds hundreds of milliseconds after the socket starts listening.

The staged candidate, measured on the same machine and Node runtime later that day after packaging and smoke checks, produced these results. Filesystem cache conditions remained uncontrolled; these are warm comparisons, not cold-launch acceptance measurements.

| Mode | Run | Listening | First health | Ready | Runtime modules |
| --- | --- | ---: | ---: | ---: | ---: |
| Direct | 1 | 268 ms | 761 ms | 860 ms | 483 ms |
| Direct | 2 | 276 ms | 733 ms | 826 ms | 450 ms |
| Direct | 3 | 263 ms | 722 ms | 823 ms | 452 ms |
| Browser handshake | 1 | 265 ms | 299 ms | 883 ms | 450 ms |
| Browser handshake | 2 | 251 ms | 267 ms | 835 ms | 447 ms |
| Browser handshake | 3 | 260 ms | 264 ms | 835 ms | 450 ms |

With the handshake, the static index arrived at 302/269/267 ms and browser authentication was sent at 306/271/269 ms. All three runs served the loading page before starting runtime imports. This checks the protocol gate; it does not include actual browser launch, script loading, rendering, or Rhino launcher overhead.

Comparing the three-run medians, runtime imports fell from 673 to 452 ms (33%) and direct readiness from 1027 to 826 ms (20%). The handshake moved the first health response from the baseline's 939 ms to 267 ms (72%) while the candidate reached runtime readiness at a median 835 ms. More runs under controlled first-launch conditions are needed to establish the cold-start improvement.

## Packaging and verification

The release build consolidates Pi 0.85.1's 193-module SDK graph into one 836,154-byte bundle behind the original public entry. Original module URLs are preserved for package discovery, extension aliases, and image workers. Third-party packages remain external to this bundle. TypeBox 1.3.7's nine public exports are built together: 682 runtime files / 821,985 bytes become 19 files / 371,076 bytes, with shared format registries intact.

Original Pi modules remain available for workers and compatibility. Terminal and extension APIs remain supported; this change reduces startup file reads without removing those capabilities. Retaining those files adds a small amount of package size in exchange for faster loading:

| Package | Staged bytes | Dependency bytes | Yak bytes |
| --- | ---: | ---: | ---: |
| Installed Windows baseline | 85,851,361 | 60,512,581 | Not measured |
| Clean Windows candidate | 86,238,320 | 60,893,151 | 38,807,798 |
| Clean macOS arm64 candidate | 83,080,713 | 57,732,207 | 37,477,636 |

Both clean packages pass the existing category and total size budgets without raising them. Packaging emits a runtime bundle report beside the stage. File replacements detach pnpm hardlinks instead of modifying its store or other installations; regression tests cover this behavior.

A final clean Windows package including the current Rhino-host branch's stability fixes served the loading page in 289/304/304 ms and became ready in 912/894/907 ms across three simulated browser-handshake runs. Runtime imports took 492/470/473 ms, a median 30% below the original 673 ms baseline. These remain uncontrolled-cache protocol measurements.

Validation on Windows with Node 22.22.3: 427 Vitest tests passed with one skipped (`pnpm exec vitest run --maxWorkers=4`), two benchmark isolation/cleanup tests passed, both TypeScript checks passed, 142 .NET tests passed, and the cross-language RPC smoke passed. The Windows package smoke verifies public SDK/extension identity, package relocation, actual image-worker completion, providers, sessions, native modules, SQLite, and esbuild. The macOS package was built and verified on Windows; its native runtime and actual Rhino/browser launch were not exercised. A pre-existing Windows path-separator assumption in the Excalidraw build test was corrected. The upstream shutdown tests invoke the registered signal handler through fixture IPC on Windows, where OS SIGTERM delivery forcibly terminates Node; POSIX retains actual signal delivery. A process-exit assertion in the existing stop-host test was flaky under unrestricted worker concurrency and passed in the four-worker suite.
