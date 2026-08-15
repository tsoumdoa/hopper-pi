# Migrating Hopper from Pi to MCP

Hopper now ships a standard MCP stdio executable, `hopper-mcp`. The Pi extension remains available as a deprecated compatibility adapter during this bridge release. Its source, skills, commands, and runtime dependencies have not been removed.

## Prerequisites

- Rhino 8 on Windows or macOS
- .NET 7 SDK to build the Grasshopper plugin during installation
- Node.js 22.19.0 or newer
- The **Hopper Code Backend** (`GHZMQ`) component on the active Grasshopper canvas

Install the package once so the host can launch a stable executable:

```bash
npm install --global hopper-pi
```

Avoid using a first-run `npx` command as an MCP host entry. Package installation can build the Grasshopper plugin and emit installer output before the stdio server starts.

## Configure an MCP host

### Codex

Run:

```bash
codex mcp add hopper -- hopper-mcp
```

Or copy [`examples/mcp/codex.toml`](../examples/mcp/codex.toml) into the shared Codex `config.toml`. See the [Codex MCP documentation](https://developers.openai.com/codex/mcp).

### Claude Code

Run:

```bash
claude mcp add hopper --scope user -- hopper-mcp
```

For project configuration, adapt [`examples/mcp/claude-code.mcp.json`](../examples/mcp/claude-code.mcp.json) as `.mcp.json`. Claude Code asks users to approve project-scoped servers. See the [Claude Code MCP documentation](https://docs.anthropic.com/en/docs/claude-code/mcp).

The executable accepts both legacy and modern MCP clients by default. Use `hopper-mcp --modern-only` only when the host is known to implement the modern MCP protocol era.

## Behavior changes

- MCP exposes a fixed, deterministic catalog of 16 Rhino and Grasshopper tools. Pi-only `ask_user`, `pick_option`, and `hopper_search_tools` are not MCP tools.
- MCP does not progressively activate tools. Host-native elicitation replaces the Pi clarification tools when supported.
- Each mutating MCP call owns its transaction and undo boundary. Pi compatibility mode retains its agent-turn transaction behavior.
- Rhino viewport capture uses MCP user interaction when the host supports it. `HOPPER_RHINO_CAPTURE_CONSENT=allow` or `deny` remains available for restricted and non-interactive hosts.
- MCP also exposes Hopper resources, prompts, canvas snapshots, and change notifications. Protocol diagnostics are written to stderr; stdout is reserved for MCP messages.
- The ZeroMQ connection profile and `GH_ZMQ_*` overrides are unchanged.

Do not run Pi and MCP frontends concurrently against the same Rhino backend while either can mutate the document. Their independent transaction boundaries can overlap.

## Temporary Pi compatibility

Existing installations can continue to use:

```bash
pi install npm:hopper-pi
```

The `pi` manifest, `src/pi`, bundled `mds` content, and Pi dependencies remain in this release. If an MCP host is incompatible, return to the Pi entry point and report the host and protocol version. Pi removal should happen only after published bridge releases have been validated with real Codex and Claude Code sessions.
