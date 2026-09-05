# Rhino package size baselines

Clean staging on 2026-09-05 with Pi 0.85.0 and pnpm 11.5.3 produced these payload baselines before Yak compression:

| Target | Files | Bytes | Approximate size | Ceiling |
| --- | ---: | ---: | ---: | ---: |
| `mac-arm64` | 11,723 | 91,359,840 | 87.1 MiB | 93 MiB |
| `win-x64` | 11,724 | 93,186,600 | 88.9 MiB | 92 MiB |

The payload includes Pi's esbuild runtime and exactly one esbuild executable for the target. Each generated SHA-256 manifest was checked for the target binary and the absence of other esbuild architectures. Update a ceiling only after inspecting the generated manifest and recording a new clean baseline here.

Both packages were staged on macOS arm64. The macOS host modules, native ZeroMQ, and esbuild transform smoke test passed with Node 26.8.1. Windows staging passed binary and package verification; its executable was not run on macOS.

These checks do not replace native Yak installation and Rhino smoke tests on macOS arm64 and Windows x64.
