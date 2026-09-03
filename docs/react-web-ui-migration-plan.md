# Hopper React web UI migration plan

## 00 / Decision record

Replace the browser UI with React, TypeScript, Vite, Tailwind CSS, and locally owned shadcn/ui components. Preserve the existing private localhost host, token authentication, WebSocket protocol, embedded Pi runtime, and Rhino RPC boundary.

This is a rendering-layer migration. The browser must continue to talk only to the Hopper host. It must not gain a direct path to ZeroMQ, Rhino, or Grasshopper.

### State management decision

Start with React `useReducer` plus a small context and custom hooks. Do not add Zustand, Redux, Jotai, or TanStack Query in the first migration.

The current UI is one connected client with one server-owned session. Its changes arrive in a strict stream through one WebSocket, so a reducer is a good fit. It makes each server message an explicit action, keeps streaming updates predictable, and avoids adding another state model beside the server's own session state.

Revisit a state library only if the UI later gains independently cached resources, several editable local workspaces, offline behavior, or cross-page state that becomes awkward to pass through context.

## 01 / Current system that must remain intact

```text
React browser client
        | WebSocket and authenticated HTTP
        v
Hopper localhost host
  server.ts + pi-runtime.ts
        | authenticated runtime RPC
        v
Rhino and Grasshopper plug-ins
```

Production assets are served by the private Hopper host on `127.0.0.1`. A random token starts in the URL fragment, moves to session storage, and authenticates the WebSocket plus runtime-status requests. The host accepts one controlling browser tab at a time.

Keep these behaviors:

- Initial `snapshot` rendering and session restoration.
- Prompt, steer, follow-up, abort, new-session, model, thinking, login, logout, and shutdown commands.
- Incremental assistant text, hidden thinking, tool-call progress, completion, and failures.
- Agent-owned select, confirm, input, editor, and authentication requests.
- Runtime-status polling with bearer-token authentication.
- Reconnect backoff, offline messaging, and safe cleanup on page close.
- Strict production origin checks and loopback-only serving.

## 02 / Proposed source tree

```text
web/
  index.html
  src/
    main.tsx
    app.tsx
    styles/globals.css
    components/
      app-shell.tsx
      conversation/
      provider/
      runtime/
      ui/                    # shadcn/ui components checked into this repository
    hooks/
      use-hopper-connection.ts
      use-runtime-status.ts
    state/
      hopper-context.tsx
      hopper-reducer.ts
      hopper-types.ts
    lib/
      host-protocol.ts
      message-normalizers.ts
      utils.ts
vite.config.ts
tsconfig.web.json
components.json
```

The Vite production output goes to `dist/host/static`. The Node host continues to serve that directory unchanged. The existing `src/host/static/` source files are removed only after the new build and packaging checks pass.

Browser-safe protocol types should move from `src/host/protocol.ts` to a shared TypeScript module imported by both the Node host and client. Runtime validation remains on the server.

## 03 / What `hopper-reducer.ts` owns

`hopper-reducer.ts` is not a replacement for the Pi session. It stores only the browser's view of that session and its connection.

```ts
type HopperState = {
  connection: {
    status: "connecting" | "authenticating" | "connected" | "disconnected" | "error";
    detail: string;
    reconnectAttempt: number;
  };
  session: {
    id: string | null;
    name: string;
    messages: ConversationMessage[];
    activeAssistantId: string | null;
    isStreaming: boolean;
  };
  tools: Record<string, ToolCallState>;
  models: ModelSummary[];
  providers: ProviderSummary[];
  selectedModel: ModelSummary | null;
  thinkingLevel: string;
  availableThinkingLevels: string[];
  pendingUiRequests: UiRequest[];
  activeUiRequest: UiRequest | null;
  notifications: ToastNotice[];
  runtimeStatus: RuntimeStatus | null;
  runtimeStatusError: string | null;
};
```

The reducer handles state transitions only. It does not open sockets, fetch HTTP, start timers, write storage, or create DOM nodes. Those jobs stay in hooks.

Representative actions:

```text
SOCKET_CONNECTING              SOCKET_AUTHENTICATED
SOCKET_CLOSED                  SOCKET_ERROR
SNAPSHOT_RECEIVED              SESSION_REPLACED
AGENT_TEXT_DELTA               AGENT_THINKING_DELTA
TOOL_STARTED                   TOOL_UPDATED                 TOOL_FINISHED
UI_REQUEST_ENQUEUED            UI_REQUEST_RESOLVED
MODELS_UPDATED                 PROVIDER_STATUS_UPDATED
RUNTIME_STATUS_RECEIVED        RUNTIME_STATUS_FAILED
TOAST_ADDED                    TOAST_DISMISSED
```

`useHopperConnection` parses each WebSocket message, normalizes Pi's agent-event shapes, and dispatches one of these actions. Components select state and call command functions exposed by the hook or context. This separation makes a streaming tool call easy to test without a browser or live Rhino instance.

## 04 / UI system

Use Tailwind for application styling and shadcn/ui for accessible primitives. shadcn components are copied into `web/src/components/ui`, so the project owns the rendered markup and can tune it to Hopper's needs.

Install and use only the primitives the product needs:

- `Button`, `Badge`, `Dialog`, `Select`, `Textarea`, `Separator`.
- `Sheet` for mobile settings.
- `ScrollArea` for the conversation.
- `Collapsible` for thinking and tool details.
- `Tooltip` for terse controls.
- A toast primitive for host, provider, and tool errors.

The first release keeps Hopper's warm paper, forest-green, orange-working-state character. The layout can move toward a more editorial control-room feel: a quiet utility sidebar, a spacious conversation surface, small technical labels, and strong hierarchy for active work. The accompanying HTML brief uses the supplied Skyline reference's sparse, requirements-first visual language as the planning-document style, not as UI code to copy.

## 05 / Delivery phases

### Phase 1: Prepare the boundary

1. Move browser-safe protocol definitions into a shared module.
2. Record representative WebSocket snapshots and agent events as test fixtures.
3. Add tests for authentication, runtime-status authorization, controller replacement, and protocol parsing before frontend changes.

### Phase 2: Build the client foundation

1. Add React, Vite, Tailwind, shadcn/ui, Lucide icons, and the web TypeScript configuration.
2. Configure Vite to write production assets to `dist/host/static`.
3. Add `ui:dev`, `ui:build`, and release-build scripts.
4. Retain the current host server's static-file behavior.

### Phase 3: Implement the state and transport layer

1. Create the reducer, context, type definitions, and event normalizers.
2. Implement `useHopperConnection` for authentication, reconnect, dispatching commands, and cleanup.
3. Implement `useRuntimeStatus` with its authenticated three-second poll and manual refresh.
4. Unit test reducer transitions against captured fixture events.

### Phase 4: Port interface behavior

1. Build the app shell, connection indicator, runtime card, and responsive settings sheet.
2. Port history rendering and live assistant streaming.
3. Port tool-call cards, thinking panels, composer modes, and session controls.
4. Port provider management and external-auth notices.
5. Port the queued agent-input dialogs and toast handling.

### Phase 5: Support Vite development without weakening production

Vite development runs on a separate origin. Add an explicit development-only host option that allows one configured Vite origin, then proxy `/ws` and `/api` through Vite. Leave strict same-origin behavior as the production default. The packaged Rhino host must never use a wildcard origin.

### Phase 6: Verify, package, and remove the legacy UI

1. Update static-asset tests for Vite's hashed asset names.
2. Add browser smoke coverage for authenticate, snapshot, prompt, streamed tool call, and agent input.
3. Run the existing TypeScript, host, cross-language RPC, and Rhino-package checks.
4. Confirm that `pnpm build:release` produces a valid `dist/host/static/index.html` plus its assets.
5. Delete the legacy static page, script, CSS, and copy script after all checks pass.

## 06 / Acceptance criteria

- A Rhino-launched production browser session works without a Vite server.
- The packaged host still binds only to loopback and rejects unauthorized origins and tokens.
- Every current browser command has a typed React equivalent.
- Reloading or opening the launch URL restores the same Pi session snapshot.
- Assistant streaming, tool status, dialogs, provider flows, and runtime status match current behavior.
- The desktop and mobile layouts remain keyboard accessible and usable with reduced motion.
- `pnpm build`, `pnpm build:release`, `pnpm test`, and Rhino packaging checks pass.
