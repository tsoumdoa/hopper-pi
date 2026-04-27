# CLI-GH Connector: Detailed Implementation Plan

## Project Structure

```
hoppercode/
├── plan.md                      # Phased implementation overview
├── SPEC.md                      # This document
│
├── rhino-zmq-poc/               # Backend: Rhino/Grasshopper ZMQ component
│   ├── rhino-zmq-poc.csproj
│   └── rhino-zmq-pocComponent.cs    # Main Grasshopper component
│
└── terminal-tui/               # Frontend: Node.js CLI
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts               # Main entry, commander CLI
        ├── cli/
        │   └── commands.ts        # CLI command definitions
        ├── domain/
        │   └── messages.ts        # Pub/sub message schemas
        └── infra/
            ├── subscriber.ts      # SUB socket client
            ├── requester.ts        # REQ socket client
            └── connection.ts       # ZMQ connection management
```

---

## Implementation Phases

### Phase 1: Minimum Viable Pub/Sub

**Goal:** Verify ZMQ connectivity works end-to-end

**Backend (`rhino-zmq-pocComponent.cs`):**
- Add timer that publishes `gh.hello` every 2 seconds
- Message: `{ "type": "gh.hello", "timestamp": 1234567890, "msg": "hello from gh" }`

**Frontend (`terminal-tui`):**
- `gh subscribe` already implemented - verify it shows `gh.hello` messages

### Phase 2: Job Submission via REQ/REP

**Goal:** Frontend submits job via REQ, backend outputs received job to GH output param

**Backend:**
- Add output parameter `Job Received` to GH component
- On `submitJob` request: output job details via output param, store in JobQueue

**Frontend:**
- `gh submit <action> [params]` sends submitJob request
- Example: `gh submit addComponent --componentType Circle --nickName "Test" --x 100 --y 200`

### Phase 3: Job Status Pub/Sub

**Goal:** Job state transitions broadcast via `gh.job.status`

- Publish `gh.job.status` on job state changes
- Frontend displays status with color coding

### Phase 4: Command Execution

**Goal:** Actually modify GH document based on submitted commands

Commands: addComponent, deleteComponent, connectWire, disconnectWire, moveComponent, renameComponent, setComponentLocked, setComponentHidden, addGroup, removeFromGroup, setSliderValue, setPanelText

### Phase 5: XML Extraction & Polish

**Goal:** Full feature set

- `gh.event.xml` on solution end
- Interactive submit mode
- Debug logging, environment variable configuration

---

## Message Schemas

### gh.hello (Phase 1)

```json
{
  "type": "gh.hello",
  "timestamp": 1234567890,
  "msg": "hello from gh"
}
```

### submitJob Request (Phase 2)

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

### submitJob Response (Phase 2)

```json
{
  "status": "ok",
  "jobId": "job-99",
  "commandId": "cmd-42",
  "queuedAt": 1234567890
}
```

### gh.job.status (Phase 3)

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

---

## ZMQ Connection Config

```typescript
const PUB_ENDPOINT = 'tcp://localhost:5555';
const REQ_ENDPOINT = 'tcp://localhost:5556';
```

### Message Flow

```
CLI Command → Commander → Requester (REQ socket) → Router (5556)
                                                      │
                                           ┌──────────┴──────────┐
                                           │  Grasshopper Plugin  │
                                           └──────────┬──────────┘
                                                      │
                             Publisher (PUB @ 5555) ← Subscriber (SUB)
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GH_ZMQ_PUB` | `localhost:5555` | Pub/sub endpoint |
| `GH_ZMQ_REQ` | `localhost:5556` | Request/reply endpoint |
| `GH_TIMEOUT_MS` | `30000` | Request timeout in milliseconds |
| `GH_DEBUG` | `0` | Enable debug logging (1 to enable) |

---

## Coding Style (TypeScript)

- Use `type` over `interface`
- Avoid `any`
- Prefer inference for obvious values
- Add return types to exported functions
- Prefer unions over enums
- Use `unknown` at boundaries
- Validate external data
- Use discriminated unions for state
- Prefer `satisfies` over `as`
- Keep abstractions simple
- Optimize for readability