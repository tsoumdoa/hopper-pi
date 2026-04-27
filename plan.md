# Rhino ZMQ POC + Terminal TUI Development Plan

## Architecture Overview

**Backend (rhino-zmq-poc)** - C# NetMQ Grasshopper component
- `PUB @ 5555`: publishes versioned topics
- `ROUTER @ 5556`: handles REQ/REP command requests

**Frontend (terminal-tui)** - TypeScript/Node CLI, use commander for CLI and chalk for color
- `SUB @ 5555`: subscribes to versioned pub/sub topics
- `REQ @ 5556`: sends command requests via REQ/REP

---

## Implementation Phases

### Phase 1: Minimum Viable Pub/Sub (Hello World)

**Goal:** Verify ZMQ connectivity works end-to-end

**Backend:**
- Timer publishes to `gh.hello` topic every 2 seconds
- Message schema:
```json
{
  "type": "gh.hello",
  "timestamp": 1234567890,
  "msg": "hello from gh"
}
```

**Frontend:**
- `gh subscribe` already implemented - just verify it shows `gh.hello` messages

**No file structure changes needed**

---

### Phase 2: Job Submission via REQ/REP

**Goal:** Frontend can submit a job, backend outputs received job to GH output param

**Backend:**
- Add output parameter `Job Received` to the GH component
- On receiving `submitJob` request via ROUTER socket:
  - Output job details via output param (jobId, command.action, commandId)
  - Store job in JobQueue but don't publish `gh.job.status` yet
- Message schema (request):
```json
{
  "type": "submitJob",
  "jobId": "job-99",
  "command": {
    "action": "addComponent",
    "params": { ... }
  }
}
```

**Response:**
```json
{
  "status": "ok",
  "jobId": "job-99",
  "commandId": "cmd-42",
  "queuedAt": 1234567890
}
```

**Frontend:**
- `gh submit <action> [params]` sends submitJob request via REQ socket
- Example: `gh submit addComponent --componentType Circle --nickName "Test" --x 100 --y 200`
- Output: `✓ job-abc123 received (cmd-xyz): addComponent`

---

### Phase 3: Job Status Pub/Sub

**Goal:** Job state transitions broadcast via gh.job.status

**Backend:**
- Publish `gh.job.status` on job state changes
- States: queued → running → completed/failed

**Message schema:**
```json
{
  "type": "gh.job.status",
  "timestamp": 1234567890,
  "jobId": "job-99",
  "commandId": "cmd-42",
  "state": "queued | running | completed | failed",
  "progress": 0-100,
  "error": null
}
```

**Frontend:**
- `gh subscribe` shows job status updates with color coding
- `gh submit` shows confirmation with jobId/commandId

---

### Phase 4: Command Execution

**Goal:** Actually modify GH document based on submitted commands

**Command types:**
- `addComponent` - add component to canvas
- `deleteComponent` - remove a component
- `connectWire` / `disconnectWire` - wire management
- `moveComponent` - reposition component
- `renameComponent` - change nickname
- `setComponentLocked` / `setComponentHidden` - visibility/lock
- `addGroup` / `removeFromGroup` - grouping
- `setSliderValue` / `setPanelText` - set values

---

### Phase 5: XML Extraction & Polish

**Goal:** Full feature set per original specification

- `gh.event.xml` - publish full GH document XML on solution end
- Interactive submit mode with numbered action list
- Debug logging with `GH_DEBUG=1`
- Environment variable configuration

---

## Connection & Error Handling

### Connection Discovery

Default endpoints hardcoded as `localhost:5555` and `localhost:5556`.
Override via environment variables:
- `GH_ZMQ_PUB=localhost:5555`
- `GH_ZMQ_REQ=localhost:5556`

### Error Handling

- Connection failures: crash and exit
- Malformed responses: log error, return error to CLI
- Request timeout: 30 second default, configurable via `GH_TIMEOUT_MS`
- GH not running: CLI prints "Cannot connect to Grasshopper. Is Rhino open?"

---

## CLI Tool (terminal-tui)

### Commands

#### `gh subscribe`
Subscribes to pub/sub events and displays them in the terminal.

#### `gh submit <action> [params]`
Submits a command to Grasshopper via REQ/REP.
Example: `gh submit addComponent --componentType Circle --nickName "Test"`

---

## Shared Message Types

```typescript
export interface GhHello {
  type: "gh.hello";
  timestamp: number;
  msg: string;
}

export interface GhJobStatus {
  type: "gh.job.status";
  timestamp: number;
  jobId: string;
  commandId: string;
  state: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  error: string | null;
}
```

---

## File Summary

| File | Owner | Purpose |
|------|-------|---------|
| `rhino-zmq-poc/rhino-zmq-pocComponent.cs` | Backend | ZMQ sockets, pub/sub, job queue, command execution |
| `terminal-tui/src/cli/commands.ts` | Frontend | CLI command definitions |
| `terminal-tui/src/infra/subscriber.ts` | Frontend | SUB socket client |
| `terminal-tui/src/infra/requester.ts` | Frontend | REQ socket client |
| `terminal-tui/src/domain/messages.ts` | Frontend | Message type definitions |