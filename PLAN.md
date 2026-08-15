# Hopper CLI port plan

## Verdict from the adversarial review

The six-PR sequence is worth keeping. The original plan had several contract holes that would have caused rework or unsafe behavior:

| Problem | Likely failure | Resolution in this plan |
| --- | --- | --- |
| The backend uses one blocking REP loop | `getRequestStatus` cannot run while a timed-out mutation still owns the REP socket | Keep request/reply semantics for clients, but replace the backend `ResponseSocket` loop with a `RouterSocket` dispatcher and an execution ledger |
| Command handlers report errors through strings | The caller can record a failed edit as successful if an error string changes | Return structured action and transaction results from C# |
| Bounded deduplication was underspecified | Evicting an old request ID permits an accidental duplicate | Use time-sortable request IDs, reject requests outside the deduplication window, and reject new work instead of evicting an unexpired entry |
| A request ID was not bound to its payload | Reusing an ID with different commands could return the wrong cached result | Store and compare a canonical payload digest |
| `unknown` had no recovery state machine | A caller could retry with a new ID or leave history pending forever | Persist the exact request before sending and define reconciliation with the original ID and payload |
| Checkpoint digest and live-canvas digest were treated as the same value | Binary serialization can differ even when the meaningful canvas is unchanged | Store a binary integrity digest and a separate canonical canvas digest |
| Undo checked the live digest in the CLI | A manual edit could land between the check and restore | Make restore an atomic compare-and-swap on Rhino's UI thread |
| Mixed Rhino and Grasshopper undo was presented as mostly safe | Restoring only Grasshopper can leave cross-document references inconsistent | Reject durable undo for Rhino and mixed edits by default |
| Journal updates were described as record mutation | A crash during rewrite can corrupt the only history record | Use append-only started and finished events, flush each mutation boundary, and derive current state by replay |
| General `batch` support was promised without an execution model | Operations that query before mutating or depend on earlier outputs cannot be made atomic by concatenating calls | Batch only operations that implement `prepareMutation`; disallow dependencies on earlier batch outputs in v1 |
| Package changes omitted build output | The installed `hopper` executable could point at TypeScript that Node cannot run | Publish `dist`, point `bin` at `dist/cli/main.js`, and add prepack and packed-tarball smoke tests |
| The backend logs raw requests | Debug logs can expose the connection token and script source | Log request metadata only and redact protocol secrets before PR 2 tests pass |

These are release blockers, not optional refinements.

## Product boundary

Build a standalone `hopper` executable that any shell-capable agent can call. Do not ship a Pi extension or an MCP server in the final package.

Rhino and Grasshopper mutations still run inside Rhino. ZeroMQ remains a private transport between the CLI and the Grasshopper plugin.

```text
agent
  |
  | shell command plus JSON input
  v
hopper CLI
  |-- operation registry and runtime validation
  |-- session lock, journal, checkpoints, and artifacts
  |-- backend client
  v
ZeroMQ request/reply protocol
  v
Grasshopper plugin
  |-- request router and deduplication ledger
  |-- UI-thread execution and transaction coordinator
  |-- document identity and checkpoint service
  v
Grasshopper document and Rhino document
```

The CLI does not contain an LLM, choose a model, ask questions, or manage an agent conversation. The calling agent owns those jobs.

## Non-negotiable invariants

1. `ok: true` means the requested work reached a terminal successful state. Queue acceptance is never success.
2. A mutating timeout is `unknown`, even if the client did not receive any response bytes.
3. Retrying a mutation uses the same request ID and byte-equivalent logical payload.
4. Reusing a request ID with a different payload returns `request_id_conflict` and performs no work.
5. Every backend mutation verifies the expected backend and document identities before touching either document.
6. Grasshopper and Rhino APIs run only on Rhino's UI thread.
7. No transaction remains open after a backend request reaches a terminal state.
8. The journal records `request.started` and flushes it before sending a mutation.
9. Checkpoint restore compares the expected live canvas digest and applies the snapshot in one UI-thread action.
10. stdout contains exactly one response document in JSON mode. Logs and progress never enter stdout.
11. History never claims durable Rhino restoration. Rhino-only and mixed edits are not eligible for normal checkpoint undo.
12. The operation registry and the C# action registry each have one runtime source of truth, with contract tests across the language boundary.

## Delivery order

Use stacked pull requests or six mergeable commits:

```text
PR 1: typed operation core and structured local results
  -> PR 2: versioned synchronous backend protocol
  -> PR 3: CLI MVP and packaging skeleton
  -> PR 4: persistent sessions and append-only journal
  -> PR 5: checkpoints, semantic diff, guarded undo/redo, constrained batch
  -> PR 6: remove Pi and finish distribution
```

Do not begin a later PR until the previous PR passes its acceptance checks. Keep the temporary Pi adapter through PR 5 so parity can be tested before removal.

## Command contract

```bash
hopper status --json
hopper catalog --json
hopper schema gh_apply_graph --json

hopper session start --name "pavilion edit" --json
hopper session show --session hs_01J... --json
hopper session list --json
hopper session close --session hs_01J... --json
hopper session rebind --session hs_01J... --json

hopper call gh_apply_graph \
  --session hs_01J... \
  --input graph.json \
  --json

hopper history list --session hs_01J... --json
hopper history show edit_000004 --session hs_01J... --json
hopper history diff edit_000004 --session hs_01J... --json
hopper history reconcile edit_000004 --session hs_01J... --json
hopper history undo edit_000004 --session hs_01J... --json
hopper history redo edit_000004 --session hs_01J... --json

hopper batch --session hs_01J... --input operations.json --json

hopper plugin install --json
hopper plugin doctor --json
```

`call` and `batch` accept exactly one input source:

- `--input path.json`
- `--input -` for stdin
- `--data '{...}'`

Reject missing input when the schema requires properties. Reject multiple input sources. Do not create one flag per operation field.

Grasshopper, Rhino document, and mixed mutations require `--session` or `HOPPER_SESSION_ID`. If both are present, the flag wins. Read-only and viewport-only operations may run without a session. `rh_capture_view` also requires `--allow-capture` or a session whose `captureAllowed` value is true.

JSON mode returns one `CliResponse` on stdout for success and failure:

```ts
export type CliResponse<T extends JsonValue = JsonValue> = {
  schemaVersion: 1;
  ok: boolean;
  command: string;
  operation?: string;
  sessionId?: SessionId;
  requestId?: RequestId;
  editId?: EditId;
  outcome: OperationOutcome;
  message: string;
  data: T | null;
  artifacts: ArtifactRecord[];
  warnings: HopperWarning[];
  error: HopperError | null;
};
```

Use these exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Terminal success |
| `2` | CLI syntax, input, schema, or unsupported-operation error |
| `3` | Backend offline, protocol mismatch, or authentication failure |
| `4` | Session, backend, document, lock, digest, or request-ID conflict |
| `5` | Terminal operation failure or partial mutation |
| `6` | Mutation outcome unknown |
| `70` | Internal CLI or journal error |

Human-readable output is allowed without `--json`. Non-interactive detection must not change JSON fields or exit codes.

## Shared TypeScript contracts

Put these exact contracts in `src/core/contracts.ts`, `src/core/errors.ts`, and `src/core/operations.ts`. If implementation work proves a signature wrong, update this plan and its contract fixtures in the same pull request.

```ts
import type { TSchema } from "@sinclair/typebox";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type JsonSchema<T extends JsonValue = JsonValue> = TSchema & { static: T };

export type SessionId = `hs_${string}`;
export type RequestId = `req_${string}`; // req_ plus a ULID
export type EditId = `edit_${string}`;
export type BackendId = `be_${string}`;
export type GrasshopperDocumentId = `ghd_${string}`;
export type RhinoDocumentId = `rhd_${string}`;

export type MutationScope = "none" | "viewport" | "grasshopper" | "rhino" | "mixed";
export type OperationOutcome =
  | "succeeded"
  | "failed"
  | "partial"
  | "unknown"
  | "in_progress";

export type HopperErrorCode =
  | "invalid_command"
  | "invalid_input"
  | "operation_not_found"
  | "operation_not_batchable"
  | "backend_offline"
  | "authentication_failed"
  | "protocol_mismatch"
  | "backend_busy"
  | "request_id_conflict"
  | "request_expired"
  | "request_not_found"
  | "session_not_found"
  | "session_locked"
  | "backend_conflict"
  | "document_conflict"
  | "canvas_conflict"
  | "unsupported_undo"
  | "operation_failed"
  | "partial_mutation"
  | "outcome_unknown"
  | "journal_corrupt"
  | "internal_error";

export type HopperError = {
  code: HopperErrorCode;
  message: string;
  retryable: boolean;
  details?: JsonObject;
};

export type HopperWarning = {
  code: string;
  message: string;
  details?: JsonObject;
};

export type ArtifactRecord = {
  artifactId: string;
  kind: "viewport_capture" | "checkpoint" | "diagnostic";
  path: string;
  mediaType: string;
  byteLength: number;
  sha256: string;
};

export type OperationResult<T extends JsonValue> = {
  outcome: OperationOutcome;
  message: string;
  data: T | null;
  warnings: HopperWarning[];
  artifacts: ArtifactRecord[];
  error: HopperError | null;
};

export type ProgressEvent = {
  phase: string;
  message: string;
  completed?: number;
  total?: number;
};

export type SessionBinding = {
  sessionId: SessionId;
  backendId: BackendId;
  grasshopperDocumentId: GrasshopperDocumentId;
  rhinoDocumentId: RhinoDocumentId | null;
};

export type PreparedMutation<T extends JsonValue = JsonValue> = {
  scope: Exclude<MutationScope, "none">;
  actions: BackendAction[];
  finish(response: ExecuteActionsResponse): OperationResult<T>;
};

export type OperationContext = {
  signal: AbortSignal;
  requestId: RequestId;
  session: SessionBinding | null;
  backend: BackendClient;
  artifacts: ArtifactWriter;
  reportProgress(event: ProgressEvent): void;
  now(): Date;
};

export type HopperOperation<
  I extends JsonValue,
  O extends JsonValue,
> = {
  name: string;
  version: 1;
  description: string;
  group: "rhino" | "gh-read" | "gh-edit" | "gh-script";
  possibleScopes: readonly MutationScope[];
  inputSchema: JsonSchema<I>;
  outputSchema: JsonSchema<O>;
  classifyScope(input: I): MutationScope;
  execute(input: I, context: OperationContext): Promise<OperationResult<O>>;
  summarizeInput(input: I): JsonObject;
  prepareMutation?: (
    input: I,
    context: OperationContext,
  ) => Promise<PreparedMutation<O>>;
};

export function defineOperation<I extends JsonValue, O extends JsonValue>(
  operation: HopperOperation<I, O>,
): HopperOperation<I, O>;

export class OperationRegistry {
  register<I extends JsonValue, O extends JsonValue>(operation: HopperOperation<I, O>): void;
  get(name: string): HopperOperation<JsonValue, JsonValue> | undefined;
  list(): readonly OperationCatalogEntry[];
  schema(name: string): OperationSchemaRecord | undefined;
  resolve(name: string, input: unknown): ResolvedOperationCall;
  execute(call: ResolvedOperationCall, context: OperationContext): Promise<OperationResult<JsonValue>>;
}

export type ResolvedOperationCall = {
  operation: HopperOperation<JsonValue, JsonValue>;
  input: JsonValue;
  scope: MutationScope;
};

export type OperationCatalogEntry = {
  name: string;
  version: number;
  description: string;
  group: HopperOperation<JsonValue, JsonValue>["group"];
  possibleScopes: readonly MutationScope[];
  batchable: boolean;
};

export type OperationSchemaRecord = OperationCatalogEntry & {
  inputSchema: JsonObject;
  outputSchema: JsonObject;
};
```

Add `@sinclair/typebox` as a direct production dependency. Use TypeBox's compiler or value checker for runtime validation. Do not depend on Pi's re-export. Validation returns structured JSON-pointer paths and never throws past `OperationRegistry.execute`.

`summarizeInput` is mandatory for mutations. Script operations return only hashes, byte counts, line counts, language, and target IDs. Generic serialization of input into history is forbidden.

`prepareMutation` is the batch boundary. An operation without it cannot appear in `hopper batch`. Preparation may query the backend but may not mutate it. A v1 batch may not reference an ID produced by an earlier item in the same batch.

Resolve and validate an operation before checking session requirements. `classifyScope` examines the validated input. Hybrid operations return `"none"` for read-only item lists and `"grasshopper"` when any item mutates. An empty item list is invalid input, not a read.

### Operation migration matrix

Keep one definition per current agent-facing operation. Extract the existing inline TypeBox schemas into the named input types below and add matching output schemas.

| Operation | Input type | Output data type | Possible scopes | Batchable input |
| --- | --- | --- | --- | --- |
| `rh_run_script` | `RhRunScriptInput` | `RhRunScriptData` | `rhino` | No |
| `rh_query_objects` | `RhQueryObjectsInput` | `RhQueryObjectsData` | `none` | No |
| `rh_view_control` | `RhViewControlInput` | `RhViewControlData` | `viewport` | No |
| `rh_capture_view` | `RhCaptureViewInput` | `RhCaptureViewData` | `none` | No |
| `gh_apply_graph` | `ApplyGraphInput` | `ApplyGraphData` | `grasshopper` | Yes |
| `gh_param_rhino` | `GhParamRhinoInput` | `ItemOperationData` | `none`, `grasshopper` | Mutation-only items |
| `gh_create_widget` | `GhCreateWidgetInput` | `ItemOperationData` | `grasshopper` | Yes |
| `gh_mutate_widget` | `GhMutateWidgetInput` | `ItemOperationData` | `grasshopper` | Yes |
| `gh_edit_components` | `GhEditComponentsInput` | `ItemOperationData` | `grasshopper` | Yes |
| `gh_edit_param` | `GhEditParamInput` | `ItemOperationData` | `none`, `grasshopper` | Mutation-only items |
| `gh_edit_wire` | `GhEditWireInput` | `ItemOperationData` | `grasshopper` | Yes |
| `gh_edit_group` | `GhEditGroupInput` | `ItemOperationData` | `grasshopper` | Yes |
| `gh_edit_script` | `GhEditScriptInput` | `ItemOperationData` | `none`, `grasshopper` | Mutation-only items |
| `gh_get_canvas` | `GhGetCanvasInput` | `GhGetCanvasData` | `none` | No |
| `gh_list_components` | `GhListComponentsInput` | `GhListComponentsData` | `none` | No |
| `gh_get_canvas_errors` | `Record<string, never>` | `GhCanvasErrorsData` | `none` | No |

```ts
export type OperationItemResult = {
  index: number;
  action: string;
  outcome: "succeeded" | "failed" | "skipped";
  targetId?: string;
  message: string;
  data: JsonValue | null;
  error: HopperError | null;
};

export type ItemOperationData = { items: OperationItemResult[] };

export type RhRunScriptData = {
  items: Array<{
    index: number;
    mode: "command" | "python" | "csharp";
    outcome: "succeeded" | "failed" | "unknown" | "skipped";
    output: string;
    echoed: boolean;
    error: string | null;
  }>;
};
export type RhQueryObjectsData = { objects: RhinoObjectInfo[]; total: number };
export type RhViewControlData = { message: string; metadata: RhinoViewMetadata | null };
export type RhCaptureViewData = { artifact: ArtifactRecord; metadata: RhinoViewMetadata | null };
export type ApplyGraphData = {
  counts: { components: number; widgets: number; scripts: number; wires: number; groups: number };
  refs: Record<string, string>;
  runtimeMessages: CanvasError[];
  overlaps: CanvasOverlapResult | null;
};
export type GhGetCanvasData = {
  document: GrasshopperDocumentIdentity;
  canvas: JsonValue;
  selectedObjectIds: string[];
};
export type GhListComponentsData = {
  components: GhComponentInfo[];
  offset: number;
  limit: number;
  total: number;
};
export type GhCanvasErrorsData = {
  errors: CanvasError[];
  overlaps: CanvasOverlapResult | null;
};
```

`RhQueryObjectsInput`, `RhViewControlInput`, `RhCaptureViewInput`, `GhParamRhinoInput`, each `Gh*Input`, and their nested item unions are direct names for the schemas already present in the corresponding tool modules. PR 1 moves them without weakening field constraints. Golden schema tests make this a mechanical rename, not an opportunity to redesign inputs silently.

PR 1 preserves the existing public `rh_run_script` operation shape: `{ items: [{ mode: "command" | "python" | "csharp", source, echo? }] }`. Its structured output contains one result per item. The singular `RhRunScriptInput` shown in the backend action section is the per-action wire payload introduced in PR 2, not a replacement for the public operation input.

Until PR 2 replaces the queued command transport, the temporary Pi backend adapter reports queue acceptance as `unknown` with `outcome_unknown`. It never reports a queued command as terminal success. Operations and tests must preserve that outcome through the registry and Pi adapter.

## Versioned backend protocol

Put TypeScript wire types in `src/protocol/wire.ts` and equivalent C# DTOs in `grasshopper-plugin/Protocol`. Keep shared JSON fixtures under `contracts/protocol/v1` and run them from both test suites.

### Envelope and identity

```ts
export const HOPPER_PROTOCOL_VERSION = 1 as const;

export type BackendIdentity = {
  backendId: BackendId;
  backendStartedAt: string;
  pluginVersion: string;
  protocolVersion: 1;
};

export type GrasshopperDocumentIdentity = {
  documentId: GrasshopperDocumentId;
  displayName: string;
  path: string | null;
};

export type RhinoDocumentIdentity = {
  documentId: RhinoDocumentId;
  runtimeSerialNumber: number;
  displayName: string;
  path: string | null;
};

export type BackendDocuments = {
  grasshopper: GrasshopperDocumentIdentity;
  rhino: RhinoDocumentIdentity | null;
};

export type WireRequest<T extends string, B extends JsonObject> = {
  protocolVersion: 1;
  type: T;
  requestId: RequestId;
  issuedAt: string;
  body: B;
  token?: string; // added only by the transport immediately before send
};

export type WireResponse<T extends JsonValue = JsonValue> = {
  protocolVersion: 1;
  type: string;
  requestId: RequestId;
  backend: BackendIdentity;
  documents: BackendDocuments | null;
  outcome: OperationOutcome;
  startedAt: string | null;
  completedAt: string | null;
  data: T | null;
  error: HopperError | null;
};

export function canonicalJsonSha256(value: JsonValue): string;
export function redactWireRequestForLog(request: WireRequest<string, JsonObject>): JsonObject;
```

Canonical JSON recursively sorts object keys, preserves array order, rejects non-finite numbers, and hashes UTF-8 bytes with SHA-256. Contract fixtures must prove that TypeScript and C# compute the same digest. A mutating request computes `payloadSha256` from the complete request body before the digest field is attached. The token, envelope request ID, issue time, and digest field are not part of the hashed value.

`backendId` is created once when the plugin service starts. Grasshopper and Rhino document IDs remain stable for that backend process. Save and rename operations change paths, not IDs. Rhino document identity uses the runtime serial number plus a backend-local ID. Rhino or Grasshopper document switches cause a session conflict. Restarting Rhino creates a new backend ID, so a persisted session requires explicit rebind.

### Backend actions and execution

Reuse the existing command parameter types, but split mutation commands from query and transaction-control actions. `getScriptCode` and `listScriptParams` move to `BackendQuery`. Begin, commit, and cancel belong to `TransactionCoordinator`, not agent-callable commands.

```ts
export type LegacyControlAction =
  | "getScriptCode"
  | "listScriptParams"
  | "beginAgentTransaction"
  | "commitAgentTransaction"
  | "cancelAgentTransaction"
  | "beginRhinoAgentTransaction"
  | "commitRhinoAgentTransaction"
  | "cancelRhinoAgentTransaction";

export type MutationCommandAction = Exclude<CommandAction, LegacyControlAction>;
export type MutationCommandMap = Pick<CommandMap, MutationCommandAction>;

export type LowLevelCommand<A extends MutationCommandAction = MutationCommandAction> = {
  action: A;
  params: MutationCommandMap[A];
};

export type BackendAction =
  | { kind: "command"; command: LowLevelCommand }
  | { kind: "applyGraph"; input: NormalizedApplyGraphRequest }
  | { kind: "runRhinoScript"; input: RhRunScriptInput }
  | { kind: "controlRhinoView"; input: JsonObject };

export type RhRunScriptInput = {
  mode: "python" | "csharp";
  source: string;
  echo?: boolean;
};

export type ExecuteActionsBody = {
  expectedBackendId: BackendId;
  expectedGrasshopperDocumentId: GrasshopperDocumentId;
  expectedRhinoDocumentId: RhinoDocumentId | null;
  expectedCanvasDigest: string | null;
  transactionName: string;
  scope: Exclude<MutationScope, "none">;
  actions: BackendAction[];
};

export type ExecuteActionsRequest = WireRequest<"executeActions", ExecuteActionsBody> & {
  payloadSha256: string;
};

export type ActionResult = {
  index: number;
  kind: BackendAction["kind"];
  action?: MutationCommandAction;
  outcome: "succeeded" | "failed" | "skipped" | "unknown";
  message: string;
  data: JsonValue | null;
  error: HopperError | null;
  elapsedMs: number;
};

export type TransactionResult = {
  outcome: "committed" | "rolled_back" | "unchanged" | "partial" | "unknown";
  grasshopperUndoRecorded: boolean;
  rhinoUndoRecorded: boolean;
  grasshopperRolledBack: boolean;
  rhinoRolledBack: boolean;
  limitations: string[];
};

export type ExecuteActionsData = {
  payloadSha256: string;
  actions: ActionResult[];
  transaction: TransactionResult;
  canvasDigestBefore: string | null;
  canvasDigestAfter: string | null;
  elapsedMs: number;
};

export type ExecuteActionsResponse = WireResponse<ExecuteActionsData>;
```

Viewport control uses `scope: "viewport"`. It runs synchronously and participates in request deduplication, but it does not open a Grasshopper or Rhino document undo record and does not require a persistent session. PR 1 must classify `rh_view_control` this way rather than pretending camera changes are read-only.

Every session-bound mutation sends both values recorded in the binding, including a recorded null Rhino identity, and rejects any change to either document. A sessionless viewport call fetches and sends both current identities immediately before execution. Rhino, mixed, and viewport scopes fail before execution when there is no active Rhino document.

### Read protocol

Move every existing direct request handler behind the same versioned envelope. A read request gets a request ID for tracing but does not enter the mutation ledger.

```ts
export type BackendQuery =
  | { kind: "getCurrentCanvas"; input: { selectionOnly?: boolean } }
  | { kind: "getCanvasErrors"; input: Record<string, never> }
  | { kind: "listAllComponents"; input: Record<string, never> }
  | { kind: "listScriptParams"; input: { targetId: string } }
  | { kind: "getScriptCode"; input: { targetId: string } }
  | { kind: "queryRhinoObjects"; input: RhinoObjectQueryParams }
  | { kind: "getParamRhinoGeometry"; input: { targetId: string } }
  | { kind: "captureRhinoView"; input: JsonObject };

export type QueryBackendRequest = WireRequest<"query", {
  expectedBackendId?: BackendId;
  expectedGrasshopperDocumentId?: GrasshopperDocumentId;
  expectedRhinoDocumentId?: RhinoDocumentId;
  query: BackendQuery;
}>;

export type QueryBackendResponse<T extends JsonValue = JsonValue> = WireResponse<T>;
```

If expected identities are present, verify them before the read. The response always reports the identities actually used. Preserve specific typed domain responses inside `data`; do not fall back to formatted text.

All handlers must stop returning semantic errors as strings. A thrown exception becomes `operation_failed` unless the transaction coordinator reports `partial` or `unknown`. Never infer failure by searching text for `" error:"`.

Grasshopper rollback can restore the before snapshot. Rhino rollback is best effort because arbitrary Rhino scripts can perform work outside a native undo record. If a mixed or Rhino action fails after changing Rhino, return `partial`. Do not label it rolled back unless the coordinator verifies the native undo operation completed.

The coordinator executes actions in array order and stops on the first failure. Remaining actions are `skipped`. Grasshopper-only requests restore the outer before snapshot on failure and record no undo entry. Successful Grasshopper or mixed requests create at most one Grasshopper undo entry. Successful Rhino or mixed requests create at most one Rhino undo entry. Existing inner transaction calls, including the current `applyGraph` snapshot transaction, must be disabled when invoked through the coordinator so nested undo records cannot appear.

Result invariants are strict. `succeeded` has `error: null`. `failed`, `partial`, and `unknown` have a non-null error. `in_progress` is valid only for status or a duplicate request that is still running. A response cannot report a committed transaction with a failed action.

### Status, deduplication, and timeout

```ts
export type GetBackendInfoRequest = WireRequest<"getBackendInfo", Record<string, never>>;
export type GetBackendInfoResponse = WireResponse<{
  capabilities: string[];
  maxRequestBytes: number;
  maxCheckpointBytes: number;
  deduplicationWindowMs: number;
}>;

export type GetRequestStatusRequest = WireRequest<"getRequestStatus", {
  targetRequestId: RequestId;
  payloadSha256: string;
}>;

export type RequestStatusData = {
  targetRequestId: RequestId;
  state: "running" | "succeeded" | "failed" | "partial" | "unknown" | "not_found" | "expired";
  cachedResponse: ExecuteActionsResponse | null;
};

export type GetRequestStatusResponse = WireResponse<RequestStatusData>;
```

Generate request IDs as `req_` plus ULID. The backend validates the ULID timestamp. Default deduplication window is 24 hours and is advertised by `getBackendInfo`.

Ledger rules:

1. On the first valid request, atomically insert `{ requestId, payloadSha256, state: "running" }` before scheduling UI work.
2. The same ID and digest returns the current state or cached terminal response.
3. The same ID with a different digest returns `request_id_conflict` and performs no work.
4. A request whose ULID is older than the advertised window returns `request_expired` and performs no work.
5. Retain every unexpired entry. If the configured capacity is full, return `backend_busy`. Do not evict an unexpired entry.
6. Client disconnect or timeout does not cancel an accepted mutation.
7. A backend restart changes `backendId`; the session conflict prevents an automatic retry against an empty ledger.

`unknown` is a client-side statement until the backend confirms a terminal result. On timeout, the CLI closes the REQ socket, preserves the exact request and digest in the journal, and exits `6`. Reconciliation opens a new socket and asks for status. If the request is `not_found`, the CLI may resend the exact request only when the backend ID matches, the request is inside the deduplication window, and the user invoked `history reconcile`. Automatic retry is limited to connection failures proven to occur before any bytes were sent.

### TypeScript transport signatures

```ts
export type RequestOptions = {
  receiveTimeoutMs: number;
  signal?: AbortSignal;
};

export class Requester {
  connect(options?: { refresh?: boolean }): Promise<void>;
  request<T extends JsonValue>(
    request: WireRequest<string, JsonObject>,
    options: RequestOptions,
  ): Promise<WireResponse<T>>;
  close(): Promise<void>;
}

export interface BackendClient {
  getInfo(signal?: AbortSignal): Promise<GetBackendInfoResponse>;
  query<T extends JsonValue>(
    request: QueryBackendRequest,
    signal?: AbortSignal,
  ): Promise<QueryBackendResponse<T>>;
  getRequestStatus(
    requestId: RequestId,
    payloadSha256: string,
    signal?: AbortSignal,
  ): Promise<GetRequestStatusResponse>;
  executeActions(
    request: ExecuteActionsRequest,
    signal?: AbortSignal,
  ): Promise<ExecuteActionsResponse>;
  captureCheckpoint(
    request: CaptureCheckpointRequest,
    signal?: AbortSignal,
  ): Promise<CaptureCheckpointResponse>;
  restoreCheckpoint(
    request: RestoreCheckpointRequest,
    signal?: AbortSignal,
  ): Promise<RestoreCheckpointResponse>;
}

export function createBackendClient(config: ConnectionConfig): BackendClient;
export type TransportSendState = "not_sent" | "possibly_sent";
export function mapTransportError(
  error: unknown,
  sendState: TransportSendState,
  requestKind: "read" | "mutation",
): HopperError;
```

After any timeout or abort, `Requester` must set zero linger, close the socket, and never reuse it. It must enforce a maximum response size before JSON parsing. Once socket send begins, transport failures use `possibly_sent`; local queueing is not proof that the backend accepted or rejected the request.

### C# service signatures

The C# types mirror the JSON contracts. Use explicit JSON property names and fixture tests rather than relying on serializer naming defaults.

```csharp
internal interface IBackendRequestHandler
{
    Task<WireResponse> HandleAsync(RequestContext context, JsonElement body);
}

internal sealed class RequestContext
{
    public string RequestId { get; init; }
    public string IssuedAt { get; init; }
    public BackendIdentity Backend { get; init; }
    public BackendDocuments Documents { get; init; }
    public CancellationToken ServiceStopping { get; init; }
}

internal sealed class BackendRequestRouter
{
    public void Register(string requestType, IBackendRequestHandler handler);
    public Task<WireResponse> DispatchAsync(string json, CancellationToken stoppingToken);
}

internal interface IRequestLedger
{
    BeginRequestResult TryBegin(string requestId, string payloadSha256, DateTimeOffset issuedAt);
    bool TryGet(string requestId, string payloadSha256, out RequestLedgerEntry entry);
    void Complete(string requestId, WireResponse response);
    void MarkUnknown(string requestId, HopperError error);
    void RemoveExpired(DateTimeOffset now);
}

internal interface IBackendActionExecutor
{
    ActionResult Execute(GH_Document ghDocument, Rhino.RhinoDoc rhinoDocument, BackendAction action);
}

internal interface ICommandHandler
{
    string Action { get; }
    ActionResult Execute(GH_Document ghDocument, Rhino.RhinoDoc rhinoDocument, JsonElement parameters);
}

internal sealed class CommandHandlerRegistry
{
    public void Register(ICommandHandler handler);
    public bool TryGet(string action, out ICommandHandler handler);
    public IReadOnlyCollection<string> KnownActions { get; }
}

internal interface IUiThreadDispatcher
{
    Task<T> InvokeAsync<T>(Func<T> work, CancellationToken serviceStopping);
}

internal interface IDocumentExecutionGate
{
    Task<IDisposable> AcquireMutationAsync(
        string grasshopperDocumentId,
        TimeSpan timeout,
        CancellationToken serviceStopping);
}

internal sealed class TransactionCoordinator
{
    public Task<ExecuteActionsResponse> ExecuteAsync(
        ExecuteActionsRequest request,
        GH_Document ghDocument,
        Rhino.RhinoDoc rhinoDocument,
        CancellationToken serviceStopping);
}

internal sealed class DocumentIdentityService
{
    public BackendIdentity GetBackendIdentity();
    public BackendDocuments GetDocumentIdentities(GH_Document ghDocument, Rhino.RhinoDoc rhinoDocument);
    public void VerifyExpected(
        string backendId,
        string grasshopperDocumentId,
        string rhinoDocumentId,
        MutationScope scope,
        GH_Document ghDocument,
        Rhino.RhinoDoc rhinoDocument);
}
```

Use a `RouterSocket` receive/send loop so a long-running execution does not prevent status requests from being received. The socket thread owns the NetMQ socket. It dispatches work to tasks and sends completed replies from a thread-safe outbound queue. Worker tasks never touch the socket.

`TransactionCoordinator` acquires `IDocumentExecutionGate` before it schedules mutation work and holds it through commit, rollback, digest capture, and ledger completion. This gate is required even when the CLI holds a session lock because two sessions can bind to the same document. If the gate deadline expires, return `backend_busy` before mutation. Read-only requests may bypass the mutation gate but still marshal Grasshopper and Rhino access to the UI thread.

The dispatcher logs request type, request ID, byte length, and outcome. It never logs tokens, bodies, script source, checkpoint bytes, or raw messages.

## Session and journal contracts

### State layout

```text
<state-root>/
  sessions/
    hs_01J.../
      session.json
      events.jsonl
      requests/
        req_01J....json
      checkpoints/
        cp_01J....ghbin.gz
      artifacts/
      .write-lock/
        owner.json
```

Use the OS application-state directory and allow `HOPPER_STATE_DIR` for tests and advanced users. Create directories and files with owner-only permissions where the platform supports them. Checkpoints contain script source and must be treated as sensitive even though journal summaries are redacted.

```ts
export type SessionRecord = {
  schemaVersion: 1;
  sessionId: SessionId;
  name: string | null;
  createdAt: string;
  closedAt: string | null;
  binding: {
    backendId: BackendId;
    grasshopperDocumentId: GrasshopperDocumentId;
    grasshopperDocumentPath: string | null;
    rhinoDocumentId: RhinoDocumentId | null;
    rhinoDocumentPath: string | null;
    boundAt: string;
  };
  captureAllowed: boolean;
  nextEditSequence: number;
  cliVersion: string;
  pluginVersion: string;
  protocolVersion: 1;
};

export type StoredRequest = {
  schemaVersion: 1;
  requestId: RequestId;
  payloadSha256: string;
  request: ExecuteActionsRequest;
};

export type HistoryEvent =
  | {
      schemaVersion: 1;
      eventType: "request.started";
      eventId: string;
      sessionId: SessionId;
      editId: EditId;
      requestId: RequestId;
      occurredAt: string;
      operation: string;
      mutationScope: MutationScope;
      inputSummary: JsonObject;
      backendId: BackendId;
      grasshopperDocumentId: GrasshopperDocumentId;
      rhinoDocumentId: RhinoDocumentId | null;
      beforeCheckpointId: string | null;
    }
  | {
      schemaVersion: 1;
      eventType: "request.outcome";
      eventId: string;
      sessionId: SessionId;
      editId: EditId;
      requestId: RequestId;
      occurredAt: string;
      outcome: OperationOutcome;
      resultSummary: JsonObject;
      error: HopperError | null;
      warnings: HopperWarning[];
      afterCheckpointId: string | null;
      diff: CanvasDiff | null;
      durationMs: number;
    }
  | {
      schemaVersion: 1;
      eventType: "session.rebound";
      eventId: string;
      sessionId: SessionId;
      occurredAt: string;
      previous: SessionRecord["binding"];
      next: SessionRecord["binding"];
    }
  | {
      schemaVersion: 1;
      eventType: "history.restored";
      eventId: string;
      sessionId: SessionId;
      editId: EditId;
      sourceEditId: EditId;
      requestId: RequestId;
      occurredAt: string;
      direction: "undo" | "redo";
      beforeCheckpointId: string;
      afterCheckpointId: string;
      outcome: OperationOutcome;
    };

export type MaterializedEdit = {
  editId: EditId;
  requestId: RequestId;
  operation: string;
  mutationScope: MutationScope;
  state: "pending" | OperationOutcome;
  startedAt: string;
  finishedAt: string | null;
  inputSummary: JsonObject;
  resultSummary: JsonObject | null;
  error: HopperError | null;
  beforeCheckpointId: string | null;
  afterCheckpointId: string | null;
  diff: CanvasDiff | null;
};
```

### Store, locking, and recovery signatures

```ts
export function resolveStateRoot(env?: NodeJS.ProcessEnv): string;

export class SessionStore {
  create(options: { name?: string; captureAllowed: boolean }, backend: BackendIdentity, documents: BackendDocuments): Promise<SessionRecord>;
  read(sessionId: SessionId): Promise<SessionRecord>;
  list(): Promise<SessionRecord[]>;
  update(session: SessionRecord): Promise<void>;
  close(sessionId: SessionId, closedAt: string): Promise<SessionRecord>;
  rebind(sessionId: SessionId, backend: BackendIdentity, documents: BackendDocuments): Promise<SessionRecord>;
  reserveEditId(sessionId: SessionId): Promise<EditId>;
  writeRequest(sessionId: SessionId, request: StoredRequest): Promise<void>;
  readRequest(sessionId: SessionId, requestId: RequestId): Promise<StoredRequest>;
}

export class Journal {
  append(event: HistoryEvent, options?: { flush?: boolean }): Promise<void>;
  readAll(): AsyncIterable<HistoryEvent>;
  materialize(): Promise<MaterializedEdit[]>;
  find(editId: EditId): Promise<MaterializedEdit | null>;
  verify(): Promise<{ ok: boolean; errors: HopperError[] }>;
}

export type LockOwner = {
  nonce: string;
  pid: number;
  hostname: string;
  processStartedAt: string;
  acquiredAt: string;
};

export interface SessionLock {
  owner: LockOwner;
  release(): Promise<void>;
}

export function acquireSessionLock(
  sessionId: SessionId,
  options?: { timeoutMs?: number; staleAfterMs?: number },
): Promise<SessionLock>;

export async function withSessionLock<T>(
  sessionId: SessionId,
  fn: (lock: SessionLock) => Promise<T>,
): Promise<T>;
```

Acquire the lock by atomically creating `.write-lock`. Store a random nonce. Remove it only if the nonce still matches. A lock is stale only when it belongs to the same host, the recorded process no longer exists, and its age exceeds the threshold. PID age alone is not enough because of PID reuse. Cross-host locks require explicit human cleanup.

Write `session.json` and stored requests through a temporary file in the same directory, flush, rename, then flush the directory when supported. Append each journal line with one write and flush `request.started` before backend send. Ignore one unterminated final JSONL line during recovery, report it as a warning, and reject corruption in any earlier line.

## Checkpoint, digest, diff, and restore contracts

### Backend checkpoint protocol

```ts
export type CanvasCheckpointEnvelope = {
  schemaVersion: 1;
  checkpointId: string;
  backendId: BackendId;
  grasshopperDocumentId: GrasshopperDocumentId;
  capturedAt: string;
  encoding: "base64";
  compression: "none";
  bytes: string;
  byteLength: number;
  binarySha256: string;
  canvasDigest: string;
};

export type CaptureCheckpointRequest = WireRequest<"captureCheckpoint", {
  expectedBackendId: BackendId;
  expectedGrasshopperDocumentId: GrasshopperDocumentId;
}>;

export type CaptureCheckpointResponse = WireResponse<CanvasCheckpointEnvelope>;

export type RestoreCheckpointRequest = WireRequest<"restoreCheckpoint", {
  expectedBackendId: BackendId;
  expectedGrasshopperDocumentId: GrasshopperDocumentId;
  expectedLiveCanvasDigest: string;
  checkpoint: CanvasCheckpointEnvelope;
  transactionName: string;
}> & {
  payloadSha256: string;
};

export type RestoreCheckpointData = {
  restoredCheckpointId: string;
  previousCanvasDigest: string;
  currentCanvasDigest: string;
  grasshopperUndoRecorded: boolean;
};

export type RestoreCheckpointResponse = WireResponse<RestoreCheckpointData>;
```

The plugin validates base64 length, decompressed size, binary digest, backend ID, document ID, and checkpoint schema before it touches the live document. Compression happens in the CLI after capture and before storage. The CLI decompresses before sending restore.

`binarySha256` protects the stored bytes. `canvasDigest` guards history. Build `canvasDigest` from a canonical canvas model that excludes the Hopper infrastructure component, volatile solution values, runtime messages, preview meshes, selection, and file path. It includes object IDs, type IDs, positions, nicknames, persistent properties, script code, group membership, and wire endpoints. Contract tests must prove digest stability across two captures with no edits.

```ts
export type CanonicalCanvas = {
  objects: CanonicalCanvasObject[];
  wires: CanonicalWire[];
  groups: CanonicalGroup[];
};

export type CanvasDiff = {
  beforeDigest: string;
  afterDigest: string;
  added: CanvasObjectChange[];
  removed: CanvasObjectChange[];
  moved: CanvasMoveChange[];
  renamed: CanvasRenameChange[];
  propertiesChanged: CanvasPropertyChange[];
  wiresAdded: CanonicalWire[];
  wiresRemoved: CanonicalWire[];
  groupsChanged: CanvasGroupChange[];
};

export type CanonicalCanvasObject = {
  id: string;
  typeId: string;
  kind: string;
  name: string;
  x: number;
  y: number;
  properties: JsonObject;
};

export type CanonicalWire = {
  fromObjectId: string;
  fromPort: string;
  toObjectId: string;
  toPort: string;
};

export type CanonicalGroup = {
  id: string;
  name: string;
  memberIds: string[];
  properties: JsonObject;
};

export type CanvasObjectChange = { id: string; object: CanonicalCanvasObject };
export type CanvasMoveChange = { id: string; before: { x: number; y: number }; after: { x: number; y: number } };
export type CanvasRenameChange = { id: string; before: string; after: string };
export type CanvasPropertyChange = { id: string; before: JsonObject; after: JsonObject };
export type CanvasGroupChange = { id: string; before: CanonicalGroup | null; after: CanonicalGroup | null };

export type CheckpointRecord = {
  checkpointId: string;
  path: string;
  compressedByteLength: number;
  binarySha256: string;
  canvasDigest: string;
};

export function canonicalizeCanvas(xml: string): CanonicalCanvas;
export function digestCanvas(canvas: CanonicalCanvas): string;
export function diffCanvases(before: CanonicalCanvas, after: CanonicalCanvas): CanvasDiff;

export class CheckpointStore {
  save(sessionId: SessionId, checkpoint: CanvasCheckpointEnvelope): Promise<CheckpointRecord>;
  read(sessionId: SessionId, checkpointId: string): Promise<CanvasCheckpointEnvelope>;
  verify(sessionId: SessionId, checkpointId: string): Promise<void>;
}

internal sealed class CanvasCheckpointService
{
    public CanvasCheckpointEnvelope Capture(
        GH_Document document,
        BackendIdentity backend,
        GrasshopperDocumentIdentity identity);
    public RestoreCheckpointData CompareAndRestore(
        GH_Document document,
        CanvasCheckpointEnvelope checkpoint,
        string expectedLiveCanvasDigest,
        string transactionName);
    public string ComputeCanvasDigest(GH_Document document);
}
```

`CompareAndRestore` runs digest comparison, snapshot application, solution expiration, post-restore digest verification, and native Grasshopper undo registration inside one UI-thread call. If the live digest differs, return `canvas_conflict` without mutation.

### History workflow

For each Grasshopper mutation:

1. Acquire the session lock.
2. Load the session and verify it is open.
3. Fetch backend identity and verify the session binding.
4. Reserve the edit ID and generate the request ID.
5. Capture and store the before checkpoint.
6. Prepare the backend actions without mutation.
7. Build and persist the exact request and payload digest. Set `expectedCanvasDigest` to the before checkpoint's canvas digest.
8. Append and flush `request.started`.
9. Send `executeActions`.
10. If terminal success, capture and store the after checkpoint and compute the diff.
11. Append and flush `request.outcome` with the observed outcome.
12. Release the lock in `finally`.

Failure rules:

- If before-checkpoint capture fails, do not execute the mutation.
- If the canvas changes during preparation or before backend execution, `expectedCanvasDigest` causes a conflict and no mutation occurs.
- If execute times out, keep the before checkpoint and record `unknown`.
- If execute succeeds but after-checkpoint capture fails, record success with `checkpoint_incomplete`; normal durable undo is unavailable until reconciliation captures and verifies the live after state.
- If after-checkpoint capture sees a canvas digest different from the execution response, record `partial` because another edit raced the capture.
- Read-only history commands do not acquire the writer lock.

`request.outcome` may appear more than once for one request. Replay permits `pending -> unknown -> succeeded|failed|partial` when later reconciliation provides evidence. The latest valid outcome wins. A known terminal outcome cannot transition to a different outcome, and replay reports such a transition as journal corruption.

Undo restores the original before checkpoint only when the live digest equals the original after digest. Redo restores the original after checkpoint only when the live digest equals the original before digest. The plugin performs this comparison atomically.

Undo and redo create a new edit ID, request ID, before checkpoint, after checkpoint, and `history.restored` event. They never rewrite the source edit.

For `mutationScope: "rhino"`, undo and redo return `unsupported_undo`. For `"mixed"`, they also return `unsupported_undo` by default. A human-only future `--grasshopper-only` mode may restore only the canvas, but agent documentation must forbid it. `--force` is not part of v1.

## CLI module signatures

```ts
export type CliIO = {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  env: NodeJS.ProcessEnv;
  cwd: string;
};

export type ParsedCommand =
  | { kind: "status"; json: boolean }
  | { kind: "catalog"; json: boolean }
  | { kind: "schema"; operation: string; json: boolean }
  | { kind: "call"; operation: string; sessionId?: SessionId; input: InputSource; allowCapture: boolean; json: boolean }
  | { kind: "batch"; sessionId: SessionId; input: InputSource; json: boolean }
  | SessionCommand
  | HistoryCommand
  | PluginCommand;

export type InputSource =
  | { kind: "file"; path: string }
  | { kind: "stdin" }
  | { kind: "inline"; json: string };

export type SessionCommand =
  | { kind: "session.start"; name?: string; captureAllowed: boolean; json: boolean }
  | { kind: "session.show"; sessionId: SessionId; json: boolean }
  | { kind: "session.list"; json: boolean }
  | { kind: "session.close"; sessionId: SessionId; json: boolean }
  | { kind: "session.rebind"; sessionId: SessionId; json: boolean };

export type HistoryCommand =
  | { kind: "history.list"; sessionId: SessionId; json: boolean }
  | { kind: "history.show"; sessionId: SessionId; editId: EditId; json: boolean }
  | { kind: "history.diff"; sessionId: SessionId; editId: EditId; json: boolean }
  | { kind: "history.reconcile"; sessionId: SessionId; editId: EditId; json: boolean }
  | { kind: "history.undo"; sessionId: SessionId; editId: EditId; json: boolean }
  | { kind: "history.redo"; sessionId: SessionId; editId: EditId; json: boolean };

export type PluginCommand =
  | { kind: "plugin.install"; force: boolean; json: boolean }
  | { kind: "plugin.doctor"; json: boolean };

export type CliDependencies = {
  registry: OperationRegistry;
  backend: BackendClient;
  sessions: SessionStore;
  openJournal(sessionId: SessionId): Journal;
  checkpoints: CheckpointStore;
  artifacts: ArtifactWriter;
  plugins: PluginManager;
  io: CliIO;
  now(): Date;
};

export type PluginDoctorReport = {
  installed: boolean;
  installPath: string | null;
  packageVersion: string;
  installedVersion: string | null;
  dotnetAvailable: boolean;
  profileReadable: boolean;
  backendReachable: boolean;
  problems: Array<{ code: string; message: string; remedy: string }>;
};

export interface PluginManager {
  install(options: { force: boolean; signal?: AbortSignal }): Promise<PluginDoctorReport>;
  doctor(options?: { signal?: AbortSignal }): Promise<PluginDoctorReport>;
}

export function parseArgs(argv: readonly string[], env: NodeJS.ProcessEnv): ParsedCommand;
export function loadJsonInput(source: InputSource, io: CliIO, maxBytes: number): Promise<unknown>;
export function mapOutcomeToExitCode(response: CliResponse): number;
export function writeCliResponse(response: CliResponse, json: boolean, io: CliIO): Promise<void>;
export async function runCli(argv: readonly string[], io: CliIO): Promise<number>;
export async function main(argv?: readonly string[]): Promise<void>;

export async function handleStatus(command: Extract<ParsedCommand, { kind: "status" }>, deps: CliDependencies): Promise<CliResponse>;
export async function handleCatalog(command: Extract<ParsedCommand, { kind: "catalog" }>, deps: CliDependencies): Promise<CliResponse>;
export async function handleSchema(command: Extract<ParsedCommand, { kind: "schema" }>, deps: CliDependencies): Promise<CliResponse>;
export async function handleCall(command: Extract<ParsedCommand, { kind: "call" }>, deps: CliDependencies): Promise<CliResponse>;
export async function handleBatch(command: Extract<ParsedCommand, { kind: "batch" }>, deps: CliDependencies): Promise<CliResponse>;
export async function handleSession(command: SessionCommand, deps: CliDependencies): Promise<CliResponse>;
export async function handleHistory(command: HistoryCommand, deps: CliDependencies): Promise<CliResponse>;
export async function handlePlugin(command: PluginCommand, deps: CliDependencies): Promise<CliResponse>;
```

`main` is the only function allowed to assign `process.exitCode`. Library code throws typed internal errors or returns `CliResponse`; it never calls `process.exit`.

Viewport capture returns base64 from the plugin to the operation. `ArtifactWriter` validates the media type and byte limit, writes the image beneath the session artifact directory or a temporary artifact directory for sessionless reads, and returns an `ArtifactRecord`. Never accept a backend-provided filesystem path.

```ts
export interface ArtifactWriter {
  write(options: {
    kind: ArtifactRecord["kind"];
    mediaType: string;
    bytes: Uint8Array;
    suggestedName?: string;
  }): Promise<ArtifactRecord>;
}

export function combineMutationScopes(scopes: readonly MutationScope[]): MutationScope;
```

## PR 1: typed operation core

### Work

- Add the shared operation, result, error, registry, validation, progress, and artifact contracts above.
- Add TypeBox as a direct dependency.
- Convert one read operation, one Grasshopper mutation, `gh_apply_graph`, and one Rhino operation first. Use those conversions to settle the adapter shape before mechanical migration.
- Convert every current `gh_*` and `rh_*` tool. Keep operation names and input schemas unless a contract test documents a correction.
- Replace Pi content arrays with structured operation data. Human text becomes an adapter concern.
- Move Pi notifications, TUI renderers, model checks, prompt routing, and consent prompts out of operation modules.
- Exclude `ask_user`, `pick_option`, and `hopper_search_tools` from the operation registry.
- Build the catalog from the operation registry.
- Keep a small Pi adapter that maps `AgentToolResult` to and from `OperationResult` for parity tests.
- Add direct tests for `summarizeInput` redaction.

### Acceptance checks

- Every operation executes through `OperationRegistry` without importing Pi types.
- Core, service, protocol, and operation modules have no `@earendil-works/pi-*` imports.
- Golden tests cover operation names, input schemas, output schemas, mutation scopes, and batchability.
- The Pi adapter still executes every current Hopper operation.
- No operation failure is represented only by prose.

## PR 2: synchronous backend protocol

### Work

- Add protocol v1 envelopes, explicit JSON names, backend and document identity, capability negotiation, payload limits, structured errors, and shared fixtures.
- Replace the REP handler loop with the router and outbound queue described above. Keep the existing endpoint field name for profile compatibility.
- Add `getBackendInfo`, `executeActions`, and `getRequestStatus`.
- Add the request ledger with digest binding, age checks, capacity refusal, terminal response caching, and cleanup.
- Refactor command execution to return `ActionResult`. Remove string error detection.
- Move transaction begin, commit, rollback, and undo recording under `TransactionCoordinator`.
- Fold the current special `applyGraph` mutation into `BackendAction` so it gets the same identity, timeout, transaction, and deduplication rules.
- Implement requester timeouts by closing the socket. Preserve `unknown` for accepted or possibly accepted mutations.
- Remove raw request logging before enabling the new protocol.
- Keep PUSH/PULL and PUB/SUB only for the temporary Pi adapter. Mark them deprecated.

### Acceptance checks

- Success proves UI-thread execution finished.
- A client can query status while another request is running.
- Same ID and same digest never execute twice.
- Same ID and different digest never execute.
- Expired IDs never execute.
- Ledger capacity exhaustion rejects work without evicting an unexpired entry.
- Backend or document mismatch performs no mutation.
- TypeScript and C# accept and emit the same fixtures and canonical payload digests.
- Timeout tests preserve an unknown outcome and successfully reconcile later.
- Logs contain no token, script source, checkpoint bytes, or full request body.

## PR 3: CLI MVP and packaging skeleton

### Work

- Add `src/cli/main.ts`, parser, handlers, input loader, output writer, and exit-code mapping.
- Add `status`, `catalog`, `schema`, and `call`.
- Make JSON errors use the same `CliResponse` shape as successes.
- Disable progress by default when stdout is not a TTY. If progress is emitted, write only to stderr.
- Add capture permission enforcement and `ArtifactWriter`.
- Close all sockets and file handles in `finally` blocks.
- Add a shebang to the built entry point and configure:

  ```json
  {
    "bin": { "hopper": "./dist/cli/main.js" },
    "files": ["dist", "mds", "grasshopper-plugin", "scripts"],
    "scripts": {
      "build": "tsc -p tsconfig.json",
      "prepack": "npm run build"
    }
  }
  ```

- Keep `src` out of the published package unless source publication is deliberate.

### Acceptance checks

- Every current operation works through `hopper call` while Rhino is running.
- File, stdin, and inline JSON inputs have success, conflict, size-limit, and invalid-JSON tests.
- JSON stdout contains one parseable object for every exit path.
- Signals, timeouts, and parse failures close sockets.
- Viewport captures cannot write outside the artifact directory.
- `npm pack`, installation into a clean temporary directory, and `hopper status --json` work on macOS and Windows.

## PR 4: persistent sessions and journal

### Work

- Add the state layout, records, atomic file writes, lock, journal replay, and recovery rules above.
- Add session commands and history list/show.
- Require a session for mutations and verify backend and document binding under the lock.
- Reserve sequences under the lock. Request IDs remain globally unique ULIDs and are not derived only from edit sequences.
- Store the exact redacted-safe wire request in `requests`; secure the directory because scripts are present there.
- Append and flush `request.started` before send and `request.outcome` after each observed unknown or terminal result.
- Add explicit `session rebind`. It records old and new bindings and never silently reconciles unknown requests from the old backend.
- Add `history reconcile` using the state machine defined above.

### Acceptance checks

- Sessions survive CLI exits and history reads work while Rhino is offline.
- Two writers cannot reserve the same edit sequence or mutate through one session concurrently.
- Stale-lock recovery cannot delete a replacement owner's lock.
- A changed backend or document causes a conflict before checkpoint or mutation work.
- Crash fixtures recover a pending edit and one truncated final journal line.
- Earlier-line corruption returns `journal_corrupt`.
- Stored requests and checkpoints use owner-only permissions where supported.

## PR 5: checkpoints, semantic diff, guarded history, and constrained batch

### Work

- Add capture and restore protocol handlers and `CanvasCheckpointService`.
- Add binary and canonical canvas digests with cross-capture stability tests.
- Add `CheckpointStore`, canonical canvas parsing, semantic diff, and the mutation workflow above.
- Add history diff, undo, redo, and reconciliation of incomplete checkpoints.
- Implement undo and redo as compare-and-swap restore requests.
- Reject Rhino and mixed durable undo by default.
- Add `batch` only for operations with `prepareMutation`.
- Prepare all batch items before mutation, concatenate their actions, send one `executeActions` request, and create one history edit and native undo record.
- Reject batches that contain reads, non-batchable operations, mixed document bindings, or references to earlier batch outputs.

### Acceptance checks

- Two no-op captures produce the same canvas digest.
- Stored-byte corruption fails before restore.
- Wrong backend, document, or live digest fails without changing the canvas.
- Diff reports added, removed, moved, renamed, property-changed, rewired, and group-changed objects.
- Undo and redo work after CLI process exit and create new history entries.
- Undo refuses unrelated later edits.
- Restore preserves the live Hopper backend component and verifies the post-restore digest.
- Failed, partial, and unknown mutations never appear as clean success.
- A batch produces one backend transaction and one history edit.

## PR 6: remove Pi and finish distribution

### Work

- Remove the Pi adapter, Pi lifecycle handlers, TUI renderers, choice extensions, model routing, visual model gating, and progressive activation.
- Remove `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, and `@earendil-works/pi-tui`.
- Remove the `pi` manifest and `pi-package` keyword.
- Rename the npm package to `hoppercode` only after checking registry ownership. Keep the executable name `hopper` regardless of package name.
- Replace postinstall mutation with `hopper plugin install` and `hopper plugin doctor`.
- Treat plugin installation as a managed-directory operation. Resolve and validate the exact target, reject symlinked targets, stage files in a sibling temporary directory, and atomically replace only the dedicated Hopper plugin directory. Never delete arbitrary contents of a user-supplied Grasshopper Libraries path.
- Record every installed file and digest in `.hopper-install.json`. Refuse upgrade if the target contains files not owned by the previous manifest. `plugin doctor` is read-only.
- Rename the connection profile directory from `hopper-pi` to `hoppercode`. During one migration release, read the old profile only when the new profile is absent. Copy it atomically and never print the token.
- Update README, skills, examples, and diagnostics around the CLI commands.
- Delete Pi-only tests after CLI parity tests cover the same behavior.

### Acceptance checks

- Production dependencies contain no Pi package.
- The package exposes no Pi extension and no MCP server.
- A fresh packed-tarball install exposes a working `hopper` executable.
- Plugin install and doctor report structured, actionable errors.
- Plugin install path tests prove that an ambiguous override, symlink target, or non-Hopper populated directory is refused without deletion.
- Old connection profiles migrate without manual token copying or token disclosure.
- Every documented agent workflow uses shell commands and sessions.

## Test matrix

### TypeScript unit and contract tests

- Registry duplication, lookup, schema, validation, and redaction
- Operation result and CLI response invariants
- Canonical JSON digest fixtures
- Parser, input source conflicts, byte limits, JSON stdout, and exit codes
- Transport timeout, abort, socket disposal, protocol mismatch, and oversized response
- Session ID allocation, atomic write, lock ownership, stale-lock recovery, and replay
- Pending and truncated-journal recovery
- Canvas canonicalization, digest stability, semantic diff, and checkpoint integrity
- Undo eligibility and expected-live-digest selection
- Batch preparation and rejection cases

### C# unit and contract tests

- Envelope parsing, explicit JSON names, auth, payload size, and log redaction
- Backend and document identity stability
- Action DTO coverage against the TypeScript command registry
- Structured action success, failure, skip, partial, and unknown results
- Request digest conflict, deduplication, expiry, capacity, status, and terminal caching
- UI-thread execution and router concurrency
- Transaction commit, Grasshopper rollback, Rhino limitation reporting, and no-op detection
- Checkpoint capture, integrity verification, digest stability, compare-and-swap restore, wrong-document rejection, and backend-component preservation

### Integration and package tests

- Run every operation through the CLI against Rhino and Grasshopper.
- Confirm a mutation response arrives after the visible canvas change.
- Kill the CLI during a mutation, inspect `unknown`, then reconcile the original request.
- Retry the same request ID and confirm no duplicate edit.
- Attempt the same ID with changed input and confirm no mutation.
- Switch Grasshopper documents and confirm session rejection.
- Switch the active Rhino document without changing the Grasshopper document and confirm session rejection.
- Restart Rhino and confirm explicit rebind is required.
- Race a manual edit against undo and confirm compare-and-swap refusal.
- Restart the CLI and perform Grasshopper undo and redo.
- Verify Rhino and mixed edits reject durable undo.
- Pack, install, run, and uninstall in clean macOS and Windows environments.

## Completion criteria

The port is complete only when:

- Agents use the `hopper` executable and no Pi runtime code ships.
- Every current Hopper operation has a typed input schema, typed output schema, structured result, mutation scope, redacted summary, and CLI parity test.
- A successful mutation response proves Rhino's UI thread finished the work.
- Request deduplication cannot silently re-execute an unexpired ID.
- Unknown outcomes remain unknown until reconciliation obtains evidence.
- Sessions bind to one backend and Grasshopper document and survive separate CLI processes.
- Journal recovery preserves pending work without rewriting history.
- Grasshopper checkpoints have separate integrity and canonical canvas digests.
- Undo and redo use backend-side compare-and-swap and never claim durable Rhino restoration.
- JSON stdout is stable and machine-readable on every exit path.
- The packed npm artifact contains built JavaScript, a working executable, and no Pi or MCP integration.
