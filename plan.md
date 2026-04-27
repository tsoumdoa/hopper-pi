# Rhino ZMQ POC + Terminal TUI Development Plan

## Architecture Overview

**Backend (rhino-zmq-poc)** â€” C# NetMQ Grasshopper component
- `PUB @ 5555`: publishes versioned topics on document changes
- `ROUTER @ 5556`: handles REQ/REP command requests

**Frontend (terminal-tui)** â€” TypeScript/Node TUI, use commander for CLI and
chalk for color
- `SUB @ 5555`: subscribes to versioned pub/sub topics
- `REQ @ 5556`: sends command requests via REQ/REP

---

## 1. Pub/Sub Topics & Message Schemas

### Topic Hierarchy

```
gh.event.*     â†’ document changes (full XML on solution)
gh.job.*       â†’ async command lifecycle
```

### Message Schemas

**`gh.event.xml`** â€” published on every solution end

Note: GH sends full XML on every solution. Client parses and computes diff locally.
Topic routing enables filtering; version field enables forward compatibility.

```json
{
  "type": "gh.event.xml",
  "version": 1,
  "timestamp": 1712345678000,
  "docName": "grasshopper_definition.gh",
  "solutionCount": 42,
  "docVersion": 120,
  "xml": "<?xml ...>"
}
```

**`gh.job.completed`** â€” published when async job finishes
```json
{
  "type": "gh.job.completed",
  "version": 1,
  "timestamp": 1712345678500,
  "jobId": "job-99",
  "commandId": "cmd-42",
  "ok": true,
  "resultVersion": 121,
  "error": null
}
```

---

## 2. REQ/REP Command Protocol

### Commands

| Command | Purpose |
|---------|---------|
| `submitJob` | Queue a command for async execution |
| `getJobStatus` | Poll job state/progress |
| `getSnapshot` | Get full document state (current behavior) |
| `getEventsSince` | Get delta events since version |
| `cancelJob` | Cancel a pending/running job |

### `submitJob`

**Request:**

```json
{
  "type": "submitJob",
  "jobId": "job-99",
  "command": {
    "action": "addComponent",
    "params": {
      "componentType": "Circle",
      "nickName": "My Circle",
      "position": { "x": 100, "y": 200 }
    }
  }
}
```

**Response (immediate):**

```json
{
  "status": "ok",
  "jobId": "job-99",
  "commandId": "cmd-42",
  "queuedAt": 1712345678000
}
```

### `getJobStatus`

**Request:**

```json
{ "type": "getJobStatus", "jobId": "job-99" }
```

**Response:**

```json
{
  "status": "ok",
  "jobId": "job-99",
  "state": "completed",
  "progress": 100,
  "resultVersion": 121,
  "submittedAt": 1712345678000,
  "completedAt": 1712345678500
}
```

State enum: `queued | running | completed | failed | cancelled`

### `getEventsSince`

**Request:**

```json
{ "type": "getEventsSince", "sinceVersion": 115 }
```

**Response:**

```json
{
  "status": "ok",
  "events": [
    { "type": "gh.event.xml", "version": 116, ... },
    { "type": "gh.event.xml", "version": 117, ... }
  ]
}
```

---

## 3. Command Types (Future Implementation)

These are operations that will be submitted as jobs:

### `addComponent`

```json
{
  "action": "addComponent",
  "params": {
    "componentType": "Circle",
    "libraryGuid": "...",
    "nickName": "My Circle",
    "position": { "x": 100, "y": 200 }
  }
}
```

### `deleteComponent`

```json
{
  "action": "deleteComponent",
  "params": {
    "targetId": "Circle_1"
  }
}
```

### `connectWire`

```json
{
  "action": "connectWire",
  "params": {
    "from": { "componentId": "A_1", "port": "out" },
    "to": { "componentId": "B_2", "port": "in" }
  }
}
```

### `disconnectWire`

```json
{
  "action": "disconnectWire",
  "params": {
    "from": { "componentId": "A_1", "port": "out" },
    "to": { "componentId": "B_2", "port": "in" }
  }
}
```

### Future Commands to Consider

- `moveComponent` â€” reposition component
- `renameComponent` â€” change nickName
- `setComponentLocked` / `setComponentHidden`
- `addGroup` / `removeFromGroup`
- `setSliderValue` / `setPanelText`

---

## 4. Job Queue State Machine

```
[submitJob]
     â”‚
     â–¼
   QUEUED â”€â”€â–º RUNNING â”€â”€â–º COMPLETED
     â”‚           â”‚             â”‚
     â”‚           â–¼             â”‚
     â”‚         FAILED â—„â”€â”€â”€â”€â”€â”€â”€â”¤
     â”‚           â”‚             â”‚
     â”‚           â–¼             â”‚
     â””â”€â”€â”€â”€â”€â–º CANCELLED â—„â”€â”€â”€â”€â”€â”€â”˜
```

- Queue is FIFO per document
- Only one job running at a time (or N parallel if spec'd)
- `cancelJob` transitions QUEUED/RUNNING â†’ CANCELLED
- Failed jobs store error message, can be retried

---

## 5. Backend Implementation Order

**Phase 1:** Topic-based pub/sub (gh.event.xml on solution, gh.job.completed on job finish)
**Phase 2:** REQ/REP `submitJob` + job queue
**Phase 3:** Implement job execution (add/delete/connect commands)
**Phase 4:** Additional polish / performance

Files:
- `rhino-zmq-poc/rhino-zmq-pocComponent.cs` â€” all backend logic

---

## 6. Frontend Implementation Order

**Phase 1:** SUB routing by topic prefix, parse versioned messages
**Phase 2:** REQ/REP `submitJob` / `getJobStatus` client
**Phase 3:** TUI updates to show job progress
**Phase 4:** Build actual TUI features (canvas view, component tree, etc.)

Files:
- `terminal-tui/index.ts` â€” main TUI logic, command client
- `terminal-tui/src/gh-parser.ts` â€” XML parsing (existing)
- `terminal-tui/src/gh-types.ts` â€” existing types
- `terminal-tui/src/gh-messages.ts` â€” NEW: pub/sub message schemas

---

## 7. Shared Message Types (gh-messages.ts)

```typescript
export interface GhEventXml {
  type: "gh.event.xml";
  version: 1;
  timestamp: number;
  docName: string;
  solutionCount: number;
  docVersion: number;
  xml: string;
}

export interface GhJobCompleted {
  type: "gh.job.completed";
  version: 1;
  timestamp: number;
  jobId: string;
  commandId: string;
  ok: boolean;
  resultVersion: number;
  error: string | null;
}

export type PubMessage = GhEventXml | GhJobCompleted;
```

---

## 8. File Summary

| File | Owner | Purpose |
|------|-------|---------|
| `rhino-zmq-poc/rhino-zmq-pocComponent.cs` | Backend | ZMQ sockets, pub/sub, job queue, command execution |
| `terminal-tui/src/gh-messages.ts` | Frontend | Shared pub/sub message type definitions |
| `terminal-tui/src/gh-types.ts` | Frontend | Existing component/wire types |
| `terminal-tui/src/gh-parser.ts` | Frontend | XML parsing |
| `terminal-tui/index.ts` | Frontend | TUI, SUB routing, command client |
