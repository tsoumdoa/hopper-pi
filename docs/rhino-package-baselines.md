# Rhino package size baselines

The clean package staging run on 2026-09-03 produced these payload baselines before Yak compression:

| Target | Files | Bytes | Approximate size | Ceiling |
| --- | ---: | ---: | ---: | ---: |
| `mac-arm64` | 10,988 | 75,033,525 | 71.6 MiB | 83 MiB |
| `win-x64` | 10,980 | 73,683,605 | 70.3 MiB | 81 MiB |

The ceilings leave about 15 percent headroom, rounded up to a whole MiB. Update a ceiling only after inspecting the generated SHA-256 manifest and recording a new clean baseline here.

These runs verify cross-target staging and binary classification. They do not replace native Yak installation and Rhino smoke tests on macOS arm64 and Windows x64.
