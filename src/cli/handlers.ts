import { createOperationRegistry } from "../operations/index.js";
import type {
	EditId,
	JsonValue,
	SessionBinding,
	SessionId,
	BackendId,
	GrasshopperDocumentId,
} from "../core/contracts.js";
import { HopperCoreError, type HopperError } from "../core/errors.js";
import { OperationRegistry, type ResolvedOperationCall } from "../core/operations.js";
import { createBackendClient, type BackendClient } from "../protocol/backend-client.js";
import type { ExecuteActionsRequest } from "../protocol/wire.js";
import { createRequestId, createWireRequest } from "../protocol/wire.js";
import { resolveConnection } from "../infra/connection.js";
import type { ConnectionConfig } from "../infra/connection.js";
import { createArtifactWriter } from "../infra/artifact-writer.js";
import type { Requester } from "../infra/requester.js";
import type { CliIO } from "./io.js";
import { loadJsonInput } from "./input.js";
import { cliError, cliResponse, type CliResponse } from "./response.js";
import type { ParsedCommand } from "./args.js";
import { createV1OperationContext, V1OperationBackend, type ExpectedIdentity } from "./backend.js";
import { SessionStore, type SessionRecord } from "../session/store.js";
import { withSessionLock } from "../session/lock.js";
import { Journal, requestOutcomeEvent, requestStartedEvent } from "../session/journal.js";
import { resolveStateRoot } from "../session/paths.js";
import { CheckpointStore } from "../session/checkpoints.js";
import { diffCanvases, emptyCanvas } from "../core/canvas.js";
import type { CanvasDiff } from "../core/contracts.js";

const CLI_VERSION = "0.1.90";

export type CliDependencies = {
	registry: OperationRegistry;
	connection: () => ConnectionConfig;
	createProtocolClient?: (connection: ConnectionConfig) => BackendClient;
	createRequester?: (connection: ConnectionConfig) => Requester;
	stateRoot: string;
	sessions: SessionStore;
	checkpoints: CheckpointStore;
	artifactsRoot?: string;
	receiveTimeoutMs?: number;
	io: CliIO;
	now(): Date;
};

export function defaultDependencies(io: CliIO): CliDependencies {
	const stateRoot = resolveStateRoot(io.env);
	return {
		registry: createOperationRegistry(),
		connection: () => resolveConnection(),
		stateRoot,
		sessions: new SessionStore(stateRoot),
		checkpoints: new CheckpointStore(stateRoot),
		io,
		now: () => new Date(),
	};
}

function protocolClient(deps: CliDependencies): BackendClient {
	return (deps.createProtocolClient ?? ((connection: ConnectionConfig) => createBackendClient(connection)))(deps.connection());
}

export async function handleStatus(
	command: Extract<ParsedCommand, { kind: "status" }>,
	deps: CliDependencies,
): Promise<CliResponse> {
	const client = protocolClient(deps);
	try {
		const info = await client.getInfo();
		if (info.outcome !== "succeeded" || info.error) {
			return cliError("status", info.error ?? {
				code: "operation_failed",
				message: `Backend status request ended ${info.outcome}.`,
				retryable: false,
			});
		}
		return cliResponse({
			ok: true,
			command: "status",
			outcome: "succeeded",
			message: "Backend online.",
			data: {
				cliVersion: CLI_VERSION,
				backend: info.backend,
				documents: info.documents,
				capabilities: info.data?.capabilities ?? [],
			} as JsonValue,
			artifacts: [],
			warnings: [],
			error: null,
		});
	} catch (error) {
		return statusFailure(error);
	} finally {
		await client.close().catch(() => {});
	}
}

function statusFailure(error: unknown): CliResponse {
	const hopper = toHopperError(error);
	return cliError("status", hopper, { message: `Backend offline or unreachable: ${hopper.message}` });
}

export function handleCatalog(
	command: Extract<ParsedCommand, { kind: "catalog" }>,
	deps: CliDependencies,
): CliResponse {
	return cliResponse({
		ok: true,
		command: "catalog",
		outcome: "succeeded",
		message: `${deps.registry.list().length} operations available.`,
		data: { operations: deps.registry.list() as unknown as JsonValue },
		artifacts: [],
		warnings: [],
		error: null,
	});
}

export function handleSchema(
	command: Extract<ParsedCommand, { kind: "schema" }>,
	deps: CliDependencies,
): CliResponse {
	const schema = deps.registry.schema(command.operation);
	if (!schema) {
		return cliError("schema", {
			code: "operation_not_found",
			message: `Unknown operation '${command.operation}'. Run 'hopper catalog'.`,
			retryable: false,
		});
	}
	return cliResponse({
		ok: true,
		command: "schema",
		operation: command.operation,
		outcome: "succeeded",
		message: `Schema for ${command.operation}.`,
		data: schema as unknown as JsonValue,
		artifacts: [],
		warnings: [],
		error: null,
	});
}

export async function handleCall(
	command: Extract<ParsedCommand, { kind: "call" }>,
	deps: CliDependencies,
): Promise<CliResponse> {
	let call: ResolvedOperationCall;
	try {
		const input = await loadJsonInput(command.input, deps.io);
		call = deps.registry.resolve(command.operation, input);
	} catch (error) {
		if (error instanceof HopperCoreError) {
			return cliError("call", error.hopperError, { operation: command.operation });
		}
		return cliError("call", {
			code: "invalid_input",
			message: error instanceof Error ? error.message : String(error),
			retryable: false,
		}, { operation: command.operation });
	}

	if (command.sessionId) {
		return callWithSession(command, call, deps);
	}
	if (call.scope !== "none" && call.scope !== "viewport") {
		return cliError("call", {
			code: "invalid_input",
			message: `Mutations with scope '${call.scope}' require --session (or HOPPER_SESSION_ID). Start one with 'hopper session start'.`,
			retryable: false,
		}, { operation: command.operation });
	}
	return executeCall(command, call, deps, { session: null });
}

async function callWithSession(
	command: Extract<ParsedCommand, { kind: "call" }>,
	call: ResolvedOperationCall,
	deps: CliDependencies,
): Promise<CliResponse> {
	const client = protocolClient(deps);
	const journal = Journal.forSession(deps.stateRoot, command.sessionId!);
	try {
		let response: CliResponse | null = null;
		await withSessionLock(command.sessionId!, deps.stateRoot, async () => {
			const session = await deps.sessions.read(command.sessionId!);
			if (session.closedAt) {
				response = cliError("call", {
					code: "session_locked",
					message: `Session ${command.sessionId} is closed.`,
					retryable: false,
				}, { operation: command.operation });
				return;
			}
			const info = await client.getInfo();
			const bindingError = verifyBinding(session, info);
			if (bindingError) {
				response = cliError("call", bindingError, {
					operation: command.operation,
					sessionId: command.sessionId,
				});
				return;
			}
			const editId = await deps.sessions.reserveEditId(command.sessionId!);
			let beforeCheckpointId: string | null = null;
			let expectedCanvasDigest: string | null = null;
			if (call.scope === "grasshopper" || call.scope === "mixed") {
				const before = await captureSessionCheckpoint(client, command.sessionId!, {
					backendId: session.binding.backendId,
					grasshopperDocumentId: session.binding.grasshopperDocumentId,
				}, deps);
				beforeCheckpointId = before.checkpointId;
				expectedCanvasDigest = before.canvasDigest;
			}
			response = await executeCall(command, call, deps, {
				session: {
					sessionId: session.sessionId,
					backendId: info.backend.backendId,
					grasshopperDocumentId: info.documents!.grasshopper.documentId,
					rhinoDocumentId: info.documents?.rhino?.documentId ?? null,
				},
				editId,
				journal,
				expected: {
					backendId: session.binding.backendId,
					grasshopperDocumentId: session.binding.grasshopperDocumentId,
					rhinoDocumentId: session.binding.rhinoDocumentId,
				},
				captureAllowed: session.captureAllowed || command.allowCapture,
				beforeCheckpointId,
				expectedCanvasDigest,
			});
		});
		return response!;
	} catch (error) {
		if (error instanceof HopperCoreError) {
			return cliError("call", error.hopperError, {
				operation: command.operation,
				sessionId: command.sessionId,
			});
		}
		return cliError("call", {
			code: "internal_error",
			message: error instanceof Error ? error.message : String(error),
			retryable: false,
		}, { operation: command.operation });
	} finally {
		await client.close().catch(() => {});
	}
}

function verifyBinding(session: SessionRecord, info: Awaited<ReturnType<BackendClient["getInfo"]>>): HopperError | null {
	if (info.backend.backendId !== session.binding.backendId) {
		return {
			code: "backend_conflict",
			message: "The backend restarted since this session was bound. Run 'hopper session rebind'.",
			retryable: false,
		};
	}
	const grasshopper = info.documents?.grasshopper;
	if (!grasshopper || grasshopper.documentId !== session.binding.grasshopperDocumentId) {
		return {
			code: "document_conflict",
			message: "The active Grasshopper document changed since this session was bound.",
			retryable: false,
		};
	}
	const rhinoId = info.documents?.rhino?.documentId ?? null;
	if (rhinoId !== session.binding.rhinoDocumentId) {
		return {
			code: "document_conflict",
			message: "The active Rhino document changed since this session was bound.",
			retryable: false,
		};
	}
	return null;
}

type CallOptions = {
	session: SessionBinding | null;
	editId?: EditId;
	journal?: Journal;
	expected?: ExpectedIdentity;
	captureAllowed?: boolean;
	beforeCheckpointId?: string | null;
	expectedCanvasDigest?: string | null;
};

async function executeCall(
	command: Extract<ParsedCommand, { kind: "call" }>,
	call: ResolvedOperationCall,
	deps: CliDependencies,
	options: CallOptions,
): Promise<CliResponse> {
	const artifactsRoot = options.session
		? `${deps.stateRoot}/sessions/${options.session.sessionId}/artifacts`
		: deps.artifactsRoot;
	const sentRequest: { request?: ExecuteActionsRequest } = {};
	const { context, backend } = createV1OperationContext(
		{
			connection: deps.connection(),
			artifacts: createArtifactWriter(artifactsRoot),
			protocolClient: deps.createProtocolClient,
			requestId: createRequestId(deps.now()),
		},
		{
			signal: AbortSignal.timeout(300_000),
			captureAllowed: options.captureAllowed ?? command.allowCapture,
			session: options.session,
			reportProgress: () => {},
		},
	);
	if (options.expected || options.editId) {
		const innerClient = backend.protocolClient;
		const sessionBackend = new V1OperationBackend(innerClient, {
			expected: options.expected,
			expectedCanvasDigest: options.expectedCanvasDigest ?? null,
			hooks: {
				onBeforeSend: async (wireRequest) => {
					sentRequest.request = wireRequest;
					if (options.session && options.journal && options.editId) {
						await deps.sessions.writeRequest(options.session.sessionId, {
							schemaVersion: 1,
							requestId: wireRequest.requestId,
							payloadSha256: wireRequest.payloadSha256,
							request: wireRequest,
						});
						await options.journal.append(requestStartedEvent({
							sessionId: options.session.sessionId,
							editId: options.editId,
							requestId: wireRequest.requestId,
							occurredAt: new Date().toISOString(),
							operation: command.operation,
							mutationScope: call.scope,
							inputSummary: call.operation.summarizeInput(call.input as never),
							backendId: options.expected?.backendId ?? "",
							grasshopperDocumentId: options.expected?.grasshopperDocumentId ?? "",
							rhinoDocumentId: options.expected?.rhinoDocumentId ?? null,
							beforeCheckpointId: options.beforeCheckpointId ?? null,
						}));
					}
				},
			},
		});
		(context as { backend: unknown }).backend = sessionBackend;
	}

	const startedAt = Date.now();
	try {
		const result = await deps.registry.execute(call, context);
		let afterCheckpointId: string | null = null;
		let diff: CanvasDiff | null = null;
		const warnings = [...result.warnings];
		if (
			options.session
			&& options.beforeCheckpointId
			&& (result.outcome === "succeeded" || result.outcome === "partial")
		) {
			try {
				const innerClient = backend.protocolClient;
				const after = await captureSessionCheckpoint(
					innerClient,
					options.session.sessionId,
					{
						backendId: options.expected?.backendId ?? options.session.backendId,
						grasshopperDocumentId: options.expected?.grasshopperDocumentId
							?? options.session.grasshopperDocumentId,
					},
					deps,
				);
				afterCheckpointId = after.checkpointId;
				const beforeStored = await deps.checkpoints.read(options.session.sessionId, options.beforeCheckpointId);
				diff = diffCanvases(beforeStored.canonicalCanvas, after.canonicalCanvas ?? emptyCanvas());
				const executionDigest = result.execution?.canvasDigestAfter ?? undefined;
				if (executionDigest && executionDigest !== after.canvasDigest) {
					result.outcome = "partial";
					result.error = {
						code: "partial_mutation",
						message: "The mutation completed, but another canvas edit raced the after checkpoint.",
						retryable: false,
					};
					warnings.push({
						code: "checkpoint_race",
						message: "The after-checkpoint digest differed from the execution response.",
					});
				}
			} catch {
				warnings.push({
					code: "checkpoint_incomplete",
					message: "The mutation succeeded but the after checkpoint could not be captured.",
				});
			}
		}
		if (options.session && options.journal && options.editId && sentRequest.request) {
			await options.journal.append(requestOutcomeEvent({
				sessionId: options.session.sessionId,
				editId: options.editId,
				requestId: sentRequest.request.requestId,
				occurredAt: new Date().toISOString(),
				outcome: result.outcome,
				resultSummary: {
					operation: command.operation,
					message: result.message,
					artifacts: result.artifacts.length,
				},
				error: result.error,
				warnings,
				afterCheckpointId,
				diff,
				durationMs: Date.now() - startedAt,
			}));
		}
		return cliResponse({
			ok: result.outcome === "succeeded",
			command: "call",
			operation: command.operation,
			sessionId: options.session?.sessionId,
			editId: options.editId,
			requestId: sentRequest.request?.requestId ?? context.requestId,
			outcome: result.outcome,
			message: result.message,
			data: result.data,
			artifacts: result.artifacts,
			warnings,
			error: result.error,
		});
	} catch (error) {
		const hopper = error instanceof HopperCoreError
			? error.hopperError
			: {
				code: "internal_error" as const,
				message: error instanceof Error ? error.message : String(error),
				retryable: false,
			};
		if (options.session && options.journal && options.editId && sentRequest.request) {
			await options.journal.append(requestOutcomeEvent({
				sessionId: options.session.sessionId,
				editId: options.editId,
				requestId: sentRequest.request.requestId,
				occurredAt: new Date().toISOString(),
				outcome: hopper.code === "outcome_unknown" ? "unknown" : "failed",
				resultSummary: {
					operation: command.operation,
					message: hopper.message,
					artifacts: 0,
				},
				error: hopper,
				warnings: [],
				afterCheckpointId: null,
				diff: null,
				durationMs: Date.now() - startedAt,
			}));
		}
		if (error instanceof HopperCoreError) {
			return cliError("call", error.hopperError, {
				operation: command.operation,
				sessionId: options.session?.sessionId,
			});
		}
		return cliError("call", hopper, { operation: command.operation });
	} finally {
		await backend.close().catch(() => {});
	}
}

function toHopperError(error: unknown): HopperError {
	if (error instanceof HopperCoreError) return error.hopperError;
	return {
		code: "backend_offline",
		message: error instanceof Error ? error.message : String(error),
		retryable: true,
	};
}

export async function captureSessionCheckpoint(
	client: BackendClient,
	sessionId: SessionId,
	expected: { backendId: string; grasshopperDocumentId: string },
	deps: CliDependencies,
) {
	const request = createWireRequest("captureCheckpoint", {
		expectedBackendId: expected.backendId as BackendId,
		expectedGrasshopperDocumentId: expected.grasshopperDocumentId as GrasshopperDocumentId,
	});
	const response = await client.captureCheckpoint(request);
	if (response.outcome !== "succeeded" || !response.data) {
		throw new HopperCoreError(response.error ?? {
			code: "operation_failed",
			message: "Checkpoint capture failed.",
			retryable: false,
		});
	}
	const record = await deps.checkpoints.save(sessionId, response.data);
	return {
		...response.data,
		checkpointId: record.checkpointId,
		canvasDigest: record.canvasDigest,
		canonicalCanvas: response.data.canonicalCanvas ?? emptyCanvas(),
	};
}

export { CLI_VERSION };
