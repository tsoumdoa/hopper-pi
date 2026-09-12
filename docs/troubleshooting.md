# Troubleshooting

| Rhino command | Purpose |
| --- | --- |
| `HopperCode` | Start Hopper or reopen the browser |
| `HopperCodeStatus` | Show connection state, web UI address, and any errors |
| `HopperCodeStop` | Detach this Rhino process, leaving the shared host running |
| `HopperCodeRestart` | Reconnect this Rhino process and reopen the browser |

`HopperCodeRestart` disconnects this Rhino instance, cleans up its connection, then connects it again. If Hopper is stopped, it starts the connection. The shared Node host keeps running, and other Rhino instances stay connected. It does not restart Rhino or reload plugin code. Wait for active modeling work to finish before restarting.

- **`HopperCode` is unknown:** Install the generated `.yak`, rather than copying only the `.gha` to Grasshopper Libraries, then restart Rhino. A Rhino `.rhp` must be loaded for the command to exist.
- **Browser tab closed:** Run `HopperCode` again in the same Rhino instance to reopen the current conversation.
- **Browser host does not open:** Run `HopperCodeStatus`. It shows whether this Rhino instance is connected, where the web UI is served, and any reported errors.
- **Node is missing or unsupported:** Run `node --version` in a terminal. If Rhino cannot see the same installation, add its absolute path to Hopper's `config.json` as shown in [Choosing Node](#choosing-node), then run `HopperCodeRestart`.
- **Grasshopper did not open:** `HopperCode` intentionally leaves Grasshopper unloaded. Submit a `gh_*` request in the browser. Hopper warns before opening Grasshopper and waits for its active definition. Run `HopperCodeStatus` for a startup or document error.
- **Invalid connection token:** Run `HopperCodeStop`, then `HopperCode` to create a new instance profile and authenticated host connection.
- **Grasshopper shows offline in Rhino.Inside.Revit:** Keep Grasshopper visible while the agent is working and inspect `HopperCodeStatus` after refocusing Rhino. Older Rhino.Inside.Revit versions may still limit background Grasshopper work.
- **Plugin did not install:** Install [.NET 8 SDK](https://dotnet.microsoft.com/download), quit Rhino, then run `pnpm build:install`.
- **Stale plugin after `git pull`:** Quit Rhino, then run `pnpm build:install --open-rhino`.

## Export a conversation for debugging

Use the conversation export control to download its recorded task state. The authenticated endpoint is `GET /api/session/export?conversationId=<conversation ID>`.

The JSON format is `hopper-conversation-debug`, version 1. It includes the selected conversation, sessions, tasks, turns, inputs, questions, events, operations, recoveries, records, and dependencies. This is a point-in-time export. Wait for active tasks to finish for complete results.

Exporting does not start or change a task. Auth-store credentials are excluded, but conversation and tool content are not redacted. Review the file before sharing it.

## Choosing Node

Hopper resolves Node in this order:

1. The absolute path in `HOPPER_NODE_EXECUTABLE`.
2. `nodeExecutable` in Hopper's app-data `config.json`.
3. `node` from the Rhino process `PATH`.
4. Standard installation paths.

The standard macOS paths are `/opt/homebrew/bin/node`, `/usr/local/bin/node`, and `/usr/bin/node`. On Windows, Hopper checks `%ProgramFiles%\nodejs\node.exe` and `%LocalAppData%\Programs\nodejs\node.exe`.

Rhino launched from Finder or the Windows desktop may have a different `PATH` than your terminal. For nvm, fnm, Volta, asdf, mise, or a custom Node install, set an absolute path in:

- macOS: `~/Library/Application Support/hopper-pi/config.json`
- Windows: `%APPDATA%\hopper-pi\config.json`

macOS example:

```json
{
  "nodeExecutable": "/Users/you/.nvm/versions/node/v22.19.0/bin/node"
}
```

Windows example:

```json
{
  "nodeExecutable": "C:\\Program Files\\nodejs\\node.exe"
}
```

The configured file must exist and be executable. Hopper runs `node --version` with a three-second timeout and rejects malformed, prerelease, or older versions. `HopperCodeStatus` shows the resolution error if Node cannot be started.
