# CLI-GH Connector: Detailed Implementation Plan

## Project Structure

```
hoppercode/
├── plan.md
├── SPEC.md                      # This document
│
├── rhino-zmq-poc/               # Backend: Rhino/Grasshopper ZMQ component
│   ├── rhino-zmq-poc.csproj
│   ├── rhino-zmq-pocComponent.cs    # Main Grasshopper component
│   ├── infra/
│   │   ├── ZeroMqPublisher.cs       # PUB socket management
│   │   ├── ZeroMqRouter.cs          # ROUTER socket for REQ/REP
│   │   └── MessageSerializer.cs     # JSON serialization
│   ├── domain/
│   │   ├── Jobs/
│   │   │   ├── Job.cs               # Job entity
│   │   │   ├── JobQueue.cs          # FIFO job queue
│   │   │   └── JobState.cs          # State machine enum
│   │   └── Commands/
│   │       ├── Command.cs           # Base command interface
│   │       ├── AddComponentCommand.cs
│   │       ├── DeleteComponentCommand.cs
│   │       ├── ConnectWireCommand.cs
│   │       └── DisconnectWireCommand.cs
│   ├── services/
│   │   ├── GrasshopperService.cs    # GH document manipulation
│   │   └── XmlEventPublisher.cs     # Publishes gh.event.xml
│   └── app/
│       └── RhinoZmqPocPlugin.cs     # Plugin entry point
│
└── terminal-tui/                 # Frontend: Node.js CLI
    ├── package.json
    ├── tsconfig.json
    ├── src/
    │   ├── index.ts               # Main entry, commander CLI
    │   │
    │   ├── cli/
    │   │   └── commands.ts        # CLI command definitions
    │   │
    │   ├── domain/
    │   │   ├── messages.ts         # Pub/sub message schemas
    │   │   ├── job.ts              # Job entity types
    │   │   └── commands.ts         # Command request/response types
    │   │
    │   ├── infra/
    │   │   ├── subscriber.ts       # SUB socket client
    │   │   ├── requester.ts        # REQ socket client
    │   │   └── connection.ts       # ZMQ connection management
    │   │
    │   └── services/
    │       └── gh-parser.ts        # XML parsing
    └── test/
```

---

## Frontend (terminal-tui) Detailed Design

### Dependencies

```json
{
  "dependencies": {
    "commander": "^12.0.0",    // CLI framework
    "chalk": "^5.3.0",         // Terminal colors
    "nanoid": "^5.0.0",        // Unique ID generation
    "zeromq": "^6.0.0",        // ZMQ bindings
    "xml2js": "^0.6.0"         // XML parsing
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "@types/node": "^20.0.0"
  }
}
```

### ZMQ Connection Config

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

## Backend (rhino-zmq-poc) Detailed Design

### Project setup

- Target: .NET Framework 4.8 or .NET 6+ (Rhino 8 compatible)
- Dependencies: NetMQ, Newtonsoft.Json

### Key Classes

**ZeroMqRouter** (infra/ZeroMqRouter.cs)
- Binds to `tcp://*:5556`
- Routes requests to JobQueue
- Returns responses via ROUTER envelope

**JobQueue** (domain/Jobs/JobQueue.cs)
- Thread-safe FIFO queue
- States: Queued → Running → Completed/Failed/Cancelled
- Emits events on state transitions

**Command implementations** (domain/Commands/*.cs)
- Each command is a class with `Execute(GrasshopperDocument)` method
- Commands are instantiated from JSON payload

---

## Implementation Phases

### Phase 1: Project Scaffolding

**terminal-tui:**
```
mkdir -p terminal-tui/src/{cli,domain,infra,services}
```

**rhino-zmq-poc:**
```
mkdir -p rhino-zmq-poc/{infra,domain/Jobs,domain/Commands,services,app}
```

### Phase 2: Frontend Core

1. `src/infra/connection.ts` — ZMQ connection setup
2. `src/infra/subscriber.ts` — SUB socket to 5555
3. `src/infra/requester.ts` — REQ socket to 5556
4. `src/domain/messages.ts` — Message type definitions
5. `src/cli/commands.ts` — Commander setup

### Phase 3: Backend Core

1. `infra/ZeroMqPublisher.cs` — PUB socket management
2. `infra/ZeroMqRouter.cs` — ROUTER socket handling
3. `domain/Jobs/JobState.cs` — State enum
4. `domain/Jobs/Job.cs` — Job entity
5. `domain/Jobs/JobQueue.cs` — Queue management
6. `domain/Commands/Command.cs` — Base interface

### Phase 4: Integration & CLI

1. Backend: Execute commands against GH document
2. Frontend: Wire up full pub/sub communication
3. Wire up full CLI output with chalk

---

## Next Steps

1. Create folder structure
2. Initialize `terminal-tui` as pnpm project with TypeScript
3.  `rhino-zmq-poc` is already created with the gh dev template. adjust the folder strucutre as per the plan  as per the folder structure, do not mess with dotnet
   version
4. Implement the phases in order
