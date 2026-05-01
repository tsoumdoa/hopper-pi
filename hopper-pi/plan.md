# Goal
- use Pi’s own building blocks
- include Pi’s UI library
- but focus first on the agent loop
- and only later build the real CLI/TUI shell

then the right sequence is:

1. prove you can run Pi’s agent/session loop in code
2. understand the event model
3. add one tool
4. add streaming and state handling
5. only then connect Pi TUI components

That aligns well with Pi’s stack:
- `@mariozechner/pi-ai`
- `@mariozechner/pi-agent-core`
- `@mariozechner/pi-coding-agent`
- `@mariozechner/pi-tui`

The docs indicate:
- `createAgentSession()` is the main higher-level entry point
- `AgentSession.subscribe()` gives you streaming/lifecycle events
- `prompt()`, `steer()`, and `followUp()` are central
- `createAgentSessionRuntime()` is for full runtime/session replacement workflows
- `@mariozechner/pi-tui` provides TUI components and rendering primitives
- if you want lower-level control, `@oh-my-pi/pi-agent` / Pi agent core exposes low-level `agentLoop`-style APIs, but for your use case the session layer is the better first step

So I would not start with the full custom TUI.
I would start with a “headless harness” around Pi’s agent session.

# Recommended build order

## Phase 1: Headless agent harness first (FINISHED)
Goal:
- no real TUI yet
- terminal output only
- learn the loop and event model

## Phase 2: Agent abstraction(FINISHED)
Goal:
- wrap Pi session/runtime in your own app service
- define app state/events independent of rendering

## Phase 3: Minimal Pi TUI rendering(FINISHED)
Goal:
- render those app events with Pi’s TUI components
- no fancy navigation yet

## Phase 4: Real custom tool / workflow UI
Goal:
- use Pi UI building blocks intentionally
- overlays, loaders, markdown, input/editor, custom components

---

# The smallest correct first step

Your minimum first milestone should be:

“Create a TypeScript project that can start a Pi agent session, send one prompt, and log streaming events.”

Do not build any UI before this works.

---

# Step-by-step development plan

## Step 1: Create the workspace

```bash
mkdir my-pi-agent-tool
cd my-pi-agent-tool
pnpm init
pnpm add -D typescript tsx @types/node
pnpm exec tsc --init
mkdir -p src
```

Use a simple `package.json`:

```json
{
  "name": "my-pi-agent-tool",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc -p tsconfig.json"
  }
}
```

Use a simple `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "skipLibCheck": true,
    "sourceMap": true
  },
  "include": ["src"]
}
```

Success criteria:
- `pnpm dev` runs a TS file

---

## Step 2: Add Pi packages, but only what you need first

For your first pass, install the session-level SDK package first.

```bash
pnpm add @mariozechner/pi-coding-agent @mariozechner/pi-ai
```

Later, when you move into actual UI, add:

```bash
pnpm add @mariozechner/pi-tui
```

Why not install everything first?
Because right now your task is understanding the loop, not rendering.

---

## Step 3: Build a headless “hello agent” runner

Goal:
- create a Pi session
- subscribe to events
- send one prompt
- print streamed output

At this stage you’re proving these things:
- auth/model config works
- session creation works
- event subscription works
- prompt lifecycle is understood

Suggested file layout now:

```text
src/
  index.ts
  agent/
    run-once.ts
```

---

## Step 4: Model the event stream before building features

Before writing more code, define what you care about from Pi events.

For example, your app probably needs to normalize Pi session events into your own internal app events like:

- agent started
- assistant text delta
- tool started
- tool finished
- agent finished
- error

This is important because your future CLI/TUI should depend on your app events, not directly on raw Pi events everywhere.

Suggested internal types:

```ts
export type AppAgentEvent =
  | { type: "run_started" }
  | { type: "text_delta"; text: string }
  | { type: "tool_started"; toolName: string; args?: unknown }
  | { type: "tool_finished"; toolName: string; result?: unknown }
  | { type: "run_finished" }
  | { type: "run_failed"; error: string };
```

Success criteria:
- you can watch the loop as a clean sequence
- you understand which Pi events matter to your tool

---

## Step 5: Wrap Pi in an adapter service

Now create a dedicated Pi service layer.

Suggested structure:

```text
src/
  index.ts
  agent/
    pi-session.ts
    types.ts
    run-once.ts
```

Responsibility:
- `pi-session.ts`: all Pi SDK interaction
- `types.ts`: your app-level event/state types
- `run-once.ts`: orchestration for one prompt

This is one of the most important design decisions.

Your future TUI should not know:
- how sessions are created
- how models are selected
- how tool wiring works
- how Pi emits its raw events

It should only know your own app events/state.

---

## Step 6: Make the first loop observable

Once the first prompt works, don’t add UI yet.
Instead, make the loop inspectable.

Add logging for:
- session id
- prompt start/end
- assistant text deltas
- tool invocations
- total elapsed time
- final messages count

This gives you a debugging harness that remains useful forever.

At this phase, your tool is basically:
- a developer console harness for Pi agent behavior

That is exactly what you want before building UI.

---

## Step 7: Add one custom tool

Now test the actual agent loop properly by giving it one tool.

Make it intentionally tiny.
Good first tool ideas:
- `getTime`
- `readLocalNote`
- `echoJson`
- `listFiles` in current directory

Why?
Because the real value of the loop is tool use.
A prompt-only run doesn’t fully validate the architecture.

Success criteria:
- agent decides to call tool
- tool executes successfully
- tool result is fed back into the loop
- assistant completes final answer

At this point you’ve validated the core Pi loop behavior.

---

## Step 8: Add abort, steer, and follow-up support

Pi sessions expose useful interaction primitives:
- `prompt()`
- `steer()`
- `followUp()`
- `abort()`

Before UI, you should prove these work from code.

Build a simple orchestrator test that can:
- start a long-running request
- send a steer message mid-run
- queue a follow-up
- abort if needed

Why this matters:
these are very likely central to the eventual TUI UX.

Success criteria:
- your app-level abstraction supports in-flight interaction, not just single-shot prompt/response

---

## Step 9: Introduce persistent session handling

Now decide whether your tool needs:
- ephemeral sessions
- resumable sessions
- tree navigation
- session replacement/new session/fork later

If yes, start using session management intentionally now.

Pi docs indicate:
- `AgentSession` is good for one active session
- `AgentSessionRuntime` is the layer for replacing active sessions (`new`, `resume`, `fork`, import-style workflows)

Recommendation:
- first implement on `createAgentSession()`
- only introduce `createAgentSessionRuntime()` after you actually need session replacement behavior

Do not jump to runtime too early unless your app specifically needs:
- switching current session
- resume/fork/new workflows
- cwd-bound runtime recreation

---

## Step 10: Define your app state machine

Before any TUI, define the minimal app state.

Example:

```ts
export type RunStatus =
  | "idle"
  | "running"
  | "awaiting_tool"
  | "completed"
  | "failed"
  | "aborted";

export type AppState = {
  status: RunStatus;
  sessionId?: string;
  outputText: string;
  toolLog: Array<{
    name: string;
    phase: "start" | "end";
    payload?: unknown;
  }>;
  error?: string;
};
```

And define reducer-like update logic from `AppAgentEvent -> AppState`.

This is huge because later:
- CLI can render it
- TUI can render it
- tests can validate it
- behavior is no longer tangled with the SDK

---

## Step 11: Add tests around the agent harness

Before UI, test these:
- event normalization
- state transitions
- tool registration
- prompt orchestration
- abort handling

Suggested dev dependency:

```bash
pnpm add -D vitest
```

Test the parts you own:
- mapping Pi event -> app event
- app event -> app state
- run orchestration with mocked subscribers/tools

Do not start with visual TUI tests.

---

# Only then move to Pi TUI

Once the above is working, start Phase 2: Pi UI integration.

The Pi docs suggest `@mariozechner/pi-tui` offers:
- `TUI`
- `ProcessTerminal`
- `Text`
- `Markdown`
- `Loader`
- `Editor`
- `Container`
- custom components via a `render(width)`/`handleInput()`/`invalidate()` style interface

That means your first TUI should not be “full app shell”.
It should be a viewer over your agent state.

---

# How to phase in Pi TUI after the loop is stable

## TUI Step 1: Read-only agent monitor
Render:
- title
- model/session info
- assistant markdown output
- tool activity
- status line

No input editor yet.

## TUI Step 2: Prompt submit box
Add:
- Pi `Editor`
- submit prompt to your agent service

## TUI Step 3: Streaming UX
Render:
- `Loader` while thinking
- `Markdown.setText(...)` on deltas
- live tool activity lines

## TUI Step 4: In-flight controls
Add keys/actions for:
- abort
- steer
- follow-up

## TUI Step 5: Extra views
Only later:
- history/session tree
- tool inspector
- logs/debug panel
- settings

---

# Best architecture for your use case

If your focus is “agent loop first”, I’d recommend this structure:

```text
src/
  index.ts
  app/
    types.ts
    state.ts
    reducer.ts
  pi/
    create-session.ts
    event-adapter.ts
    tools/
      get-time.ts
  workflows/
    run-prompt.ts
    steer.ts
    abort.ts
  ui/
    # empty for now, or added later
```

Meaning:
- `pi/`: direct SDK integration
- `app/`: your app state/events
- `workflows/`: orchestration use-cases
- `ui/`: added only after loop maturity

---

# What not to do yet

Since you want to focus on the agent loop first, avoid these early:

- custom editor component
- modal overlays
- multiple panes
- session tree UI
- slash commands
- complex runtime replacement
- packaging as a polished CLI binary
- themes and styling work
- custom Pi TUI components

All of those are second-order concerns.

---

# Concrete milestone plan

## Milestone 1: Session boots
- install Pi packages
- create one session
- send one prompt
- print streamed response

## Milestone 2: Event understanding
- subscribe to all key events
- normalize to app events
- log lifecycle clearly

## Milestone 3: Tool loop proof
- add one custom tool
- validate tool call path
- validate final answer after tool result

## Milestone 4: Interaction controls
- support `steer()`
- support `followUp()`
- support `abort()`

## Milestone 5: App state model
- reducer/state store
- output buffer
- tool activity log
- error handling

## Milestone 6: TUI viewer
- add `@mariozechner/pi-tui`
- render state only
- no editing yet

## Milestone 7: TUI input
- add editor
- submit prompt
- stream markdown
- show loader

## Milestone 8: Real tool/app UX
- overlays
- custom components
- settings/help/debug

---

# My recommendation on which Pi API to start with

Given your stated goal, start with:

1. `createAgentSession()` from `@mariozechner/pi-coding-agent`
2. `session.subscribe(...)`
3. `session.prompt(...)`
4. one custom tool
5. only later `createAgentSessionRuntime()` if you need session replacement
6. only later `@mariozechner/pi-tui`

Why this path:
- `createAgentSession()` is high enough level to be productive
- you still get access to lifecycle and streaming
- you can build your own wrapper around it
- you avoid prematurely coupling your app to full Pi interactive mode internals

---

# The most minimum first step for you now

Do only this first:

1. scaffold the TypeScript project
2. install Pi packages
3. write a file that:
   - creates a Pi session
   - subscribes to events
   - sends `"hello"`
   - prints assistant text deltas

That is the correct first step for your actual goal.

---

# If you want, I can do the next step for you

I can now generate one of these:

1. a minimal `createAgentSession()` starter in TypeScript with pnpm
2. a recommended folder structure for “agent loop first, UI later”
3. a step-by-step implementation plan for `createAgentSessionRuntime()`
4. a minimal custom-tool example to validate the agent loop
5. a headless-to-TUI migration plan using `@mariozechner/pi-tui`

If you want, I suggest we do this next:

“Give me the minimal TypeScript starter that creates a Pi agent session, subscribes to streaming events, and sends one prompt.”
