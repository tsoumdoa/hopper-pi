# Rhino ZMQ POC + Terminal TUI Development Plan

## Architecture Overview

**Backend (rhino-zmq-poc)** - C# NetMQ Grasshopper component
- `PUB @ 5555`: publishes versioned topics on document changes
- `ROUTER @ 5556`: handles REQ/REP command requests

**Frontend (terminal-tui)** - TypeScript/Node CLI, use commander for CLI and chalk for color
- `SUB @ 5555`: subscribes to versioned pub/sub topics
- `REQ @ 5556`: sends command requests via REQ/REP

---

## 1. XML Extraction (gh.event.xml)

On every solution end, extract full GH document XML using GH_Archive:

```csharp
GH_Document doc = this.OnPingDocument();
var archive = new GH_Archive();
archive.AppendObject(doc, "Definition");
string tempPath = Path.Combine(Path.GetTempPath(), "gh_definition.xml");
archive.WriteToFile(tempPath, true);
string xml = File.ReadAllText(tempPath);
```

Then publish via PUB socket with topic `gh.event.xml`.

---

## 2. Pub/Sub Topics & Message Schemas

### Topic Hierarchy

```
gh.event.*     -> document changes (full XML on solution)
gh.job.*       -> async command lifecycle
```

### Message Schemas

**gh.event.xml** - published on every solution end

```json
{
  "type": "gh.event.xml",
  "timestamp": 1712345678000,
  "docName": "grasshopper_definition.gh",
  "xml": "<?xml ...>"
}
```

**gh.job.completed** - published when async job finishes

```json
{
  "type": "gh.job.completed",
  "timestamp": 1712345678500,
  "jobId": "job-99",
  "commandId": "cmd-42",
  "ok": true,
  "error": null
}
```

---

## 3. REQ/REP Command Protocol

### Commands

| Command | Purpose |
|---------|---------|
| `submitJob` | Queue a command for async execution |
| `getJobStatus` | Poll job state/progress |
| `getSnapshot` | Get full document state |
| `getEventsSince` | Get delta events since version |
| `cancelJob` | Cancel a pending/running job |

### submitJob

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

### getJobStatus

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
  "submittedAt": 1712345678000,
  "completedAt": 1712345678500
}
```

State enum: `queued | running | completed | failed | cancelled`

### getEventsSince

**Request:**

```json
{ "type": "getEventsSince", "sinceVersion": 115 }
```

**Response:**

```json
{
  "status": "ok",
  "events": [
    { "type": "gh.event.xml", "timestamp": 1712345678000, ... },
    { "type": "gh.event.xml", "timestamp": 1712345679000, ... }
  ]
}
```

---

## 4. Command Types

### addComponent

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

### deleteComponent

```json
{
  "action": "deleteComponent",
  "params": {
    "targetId": "Circle_1"
  }
}
```

### connectWire

```json
{
  "action": "connectWire",
  "params": {
    "from": { "componentId": "A_1", "port": "out" },
    "to": { "componentId": "B_2", "port": "in" }
  }
}
```

### disconnectWire

```json
{
  "action": "disconnectWire",
  "params": {
    "from": { "componentId": "A_1", "port": "out" },
    "to": { "componentId": "B_2", "port": "in" }
  }
}
```

### Future Commands

- `moveComponent` - reposition component
- `renameComponent` - change nickName
- `setComponentLocked` / `setComponentHidden`
- `addGroup` / `removeFromGroup`
- `setSliderValue` / `setPanelText`

---

## 5. Job Queue State Machine

```
[submitJob]
     |
     v
   QUEUED ----> RUNNING ----> COMPLETED
     |            |              |
     |            v              |
     |          FAILED <---------+
     |            |              |
     |            v              |
     +----> CANCELLED <----------+
```

- Queue is FIFO per document
- Only one job running at a time (or N parallel if spec'd)
- `cancelJob` transitions QUEUED/RUNNING -> CANCELLED
- Failed jobs store error message, can be retried

---

## 6. Backend Implementation Order

**Phase 1:** Topic-based pub/sub (gh.event.xml on solution, gh.job.completed on job finish)
**Phase 2:** REQ/REP `submitJob` + job queue
**Phase 3:** Implement job execution (add/delete/connect commands)
**Phase 4:** Additional polish / performance

Files:
- `rhino-zmq-poc/rhino-zmq-pocComponent.cs` - all backend logic

---

## 7. Frontend Implementation Order

**Phase 1:** SUB routing by topic prefix, parse versioned messages
**Phase 2:** REQ/REP `submitJob` / `getJobStatus` client
**Phase 3:** Job progress display (use nanoid for jobId generation)
**Phase 4:** CLI output formatting with chalk

Dependencies: `nanoid` for jobId generation

Files:
- `terminal-tui/index.ts` - main CLI logic, command client
- `terminal-tui/src/gh-parser.ts` - XML parsing (existing)
- `terminal-tui/src/gh-types.ts` - existing types
- `terminal-tui/src/gh-messages.ts` - NEW: pub/sub message schemas

---

## 8. Shared Message Types (gh-messages.ts)

```typescript
export interface GhJobCompleted {
  type: "gh.job.completed";
  timestamp: number;
  jobId: string;
  commandId: string;
  ok: boolean;
  error: string | null;
}
```

---

## 9. File Summary

| File | Owner | Purpose |
|------|-------|---------|
| `rhino-zmq-poc/rhino-zmq-pocComponent.cs` | Backend | ZMQ sockets, pub/sub, job queue, command execution |
| `terminal-tui/src/gh-messages.ts` | Frontend | Shared pub/sub message type definitions |
| `terminal-tui/src/gh-types.ts` | Frontend | Existing component/wire types |
| `terminal-tui/src/gh-parser.ts` | Frontend | XML parsing |
| `terminal-tui/index.ts` | Frontend | TUI, SUB routing, command client |

---

## 10. Connection & Error Handling

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

## 11. Logging

Debug logging for ZMQ traffic via `GH_DEBUG` env var.
When enabled, logs:
- All published messages (topic + payload)
- All sent requests and received responses
- Connection open/close events
