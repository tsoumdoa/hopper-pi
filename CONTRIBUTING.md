# Contributing to hoppercode

Thanks for your interest in contributing! This project is a Pi extension (TypeScript) plus a Grasshopper plugin (C#). Most day-to-day work happens in the TypeScript layer under `src/`.

## Prerequisites

- **Node.js** 22+ (see `.nvmrc`)
- **pnpm** 11+ (`corepack enable && corepack prepare pnpm@latest --activate`)
- **.NET 7 SDK** (only needed when building the Grasshopper plugin)

## Dev setup

```bash
git clone https://github.com/tsoumdoa/hoppercode.git
cd hoppercode

# TypeScript-only dev (skip the C# plugin build):
export HOPPER_SKIP_GH_PLUGIN=1
pnpm install
```

If you need the Grasshopper plugin as well, drop the env var and run `pnpm install` (the postinstall script builds and installs the `.gha`).

## Common commands

| Task | Command |
| ---- | ------- |
| Run typecheck | `pnpm build` |
| Run tests | `pnpm test` |
| Dev server (TS only) | `pnpm dev` |
| Run Pi with this extension | `pnpm run pi` |
| Rebuild the GH plugin | `pnpm run build:gh-plugin` |

## Developing TypeScript-only

Set `HOPPER_SKIP_GH_PLUGIN=1` before `pnpm install` to skip the C# build. This is the fastest loop for iterating on tools, parsing, or presentation logic.

## Rebuilding the Grasshopper plugin

```bash
pnpm run build:gh-plugin
# force a full rebuild + copy:
node scripts/install-grasshopper-plugin.mjs --force
```

Restart Rhino / Grasshopper after rebuilding.

## Architecture

See the [README](README.md) for the high-level architecture, ZMQ port layout, and tool overview.

## License

MIT — see [LICENSE](LICENSE).
