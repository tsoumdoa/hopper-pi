# hoppercode

Pi extension + Grasshopper ZMQ backend for AI-driven Rhino/Grasshopper workflows.

## Packages

| Path | Role |
| ---- | ---- |
| [`hopper-pi/`](hopper-pi/) | **Pi extension** — `gh_*` / `rh_*` tools over ZeroMQ |
| [`hopper-pi/grasshopper-plugin/`](hopper-pi/grasshopper-plugin/) | **Grasshopper plugin** (C# → `rhino-zmq-poc.gha`) |

## Quick start

### End users

```bash
pi install npm:hopper-pi
```

Postinstall builds the Grasshopper plugin and installs it to `{Libraries}/hopper-pi/`. Restart Rhino, place **GH ZMQ Plugin** on the canvas, then use Pi.

See [hopper-pi/README.md](hopper-pi/README.md) for full setup, env vars, and troubleshooting.

### Developers

```bash
cd hopper-pi
export HOPPER_SKIP_GH_PLUGIN=1
pnpm install
pnpm run pi
```

In another terminal / VS Code, build and debug the C# plugin from `hopper-pi/grasshopper-plugin/` with `RHINO_PACKAGE_DIRS` (see hopper-pi README).

## Architecture

```
Pi agent  →  hopper-pi (Node)  →  ZMQ :5555–5557  →  Grasshopper plugin (Rhino)
```

- **Queries** (REQ/REP `:5557`): canvas state, component search, errors  
- **Edits** (PUSH `:5556`): add/move/wire components, scripts, widgets  
- **Events** (PUB `:5555`): job status, XML snapshots  

Legacy CLI docs in this file referred to a removed `terminal-tui/` package; the supported interface is the **Pi extension** in `hopper-pi/`.
