# Security Policy

## Threat model

hoppercode drives Rhino and Grasshopper programmatically via a ZeroMQ-based
backend that runs inside Rhino. The security boundary relies on two controls:

1. **Loopback-only binding** — the backend binds exclusively to `127.0.0.1`
   (localhost). It is not reachable from the network or other machines.

2. **Connection token** — every command and query must include a connection
   token. The token is generated once and stored in a OS-specific connection
   profile:

   - **Windows:** `%APPDATA%\hopper-pi\connection.json`
   - **macOS:** `~/Library/Application Support/hopper-pi/connection.json`
   - **Linux:** `~/.local/share/hopper-pi/connection.json`
     (or `$XDG_DATA_HOME/hopper-pi/connection.json`)

## What access means

Anyone who can read the connection profile (and thus obtain the token) can
fully drive Rhino through the backend, including:

- Running scripts (Python, C#) in the Rhino document
- Editing the Grasshopper canvas (add, move, delete components)
- Reading document geometry and canvas state

Treat the connection profile and token as a credentials file. Do not share
or commit it.

## Reporting a vulnerability

If you discover a security issue, please **do not** open a public issue.
Instead, open a **private security advisory** on GitHub:

1. Go to <https://github.com/tsoumdoa/hoppercode/security/advisories/new>
2. Describe the vulnerability and steps to reproduce.

We will acknowledge receipt as soon as possible and coordinate a fix.
