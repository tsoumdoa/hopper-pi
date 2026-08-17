import type {
	CanvasDiff,
	EditId,
	JsonValue,
	JsonObject,
	SessionId,
} from "../core/contracts.js";
import type { SessionCommand, HistoryCommand } from "./args.js";
import { cliError, cliResponse, type CliResponse } from "./response.js";
import type { CliDependencies } from "./handlers.js";
import { Journal, requestOutcomeEvent, type MaterializedEdit } from "../session/journal.js";
import { SessionStore, SessionStoreError, type SessionRecord } from "../session/store.js";
import { SessionLockError, withSessionLock } from "../session/lock.js";
import { createBackendClient, type BackendClient } from "../protocol/backend-client.js";
import {
	attachMutationPayloadSha256,
	createRequestId,
	createWireRequest,
	type RestoreCheckpointRequest,
	type GetRequestStatusResponse,
	type WireResponse,
} from "../protocol/wire.js";
import { withConnectionToken } from "../infra/connection.js";
import { captureSessionCheckpoint } from "./handlers.js";
import { envelopeForRestore } from "../session/checkpoints.js";
import { HopperCoreError } from "../core/errors.js";
import type { HopperError, HopperWarning } from "../core/errors.js";
import { diffCanvases, emptyCanvas } from "../core/canvas.js";

export async function handleSession(
	command: SessionCommand,
	deps: CliDependencies,
): Promise<CliResponse> {
	const sessions = deps.sessions;
	try {
		switch (command.kind) {
			case "session.start": {
				const client = protocol(deps);
				try {
					const info = await client.getInfo();
					if (!info.documents?.grasshopper) {
						return cliError("session.start", {
							code: "document_conflict",
							message: "No Grasshopper document is active; cannot bind a session.",
							retryable: false,
						});
					}
					const session = await sessions.create(
						{ name: command.name, captureAllowed: command.captureAllowed },
						info.backend,
						info.documents,
					);
					return sessionResponse("session.start", "Session created and bound.", session);
				} finally {
					await client.close().catch(() => {});
				}
			}
			case "session.show": {
				const session = await sessions.read(command.sessionId);
				return sessionResponse("session.show", "Session details.", session);
			}
			case "session.list": {
				const records = await sessions.list();
				return cliResponse({
					ok: true,
					command: "session.list",
					outcome: "succeeded",
					message: `${records.length} session(s).`,
					data: { sessions: records as unknown as JsonValue },
					artifacts: [],
					warnings: [],
					error: null,
				});
			}
			case "session.close": {
				const session = await sessions.close(command.sessionId, new Date().toISOString());
				return sessionResponse("session.close", "Session closed.", session);
			}
			case "session.rebind": {
				return rebindSession(command.sessionId, deps);
			}
			default: {
				const exhaustive: never = command;
				return cliError("session", {
					code: "invalid_command",
					message: `Unsupported session command ${(exhaustive as SessionCommand).kind}.`,
					retryable: false,
				});
			}
		}
	} catch (error) {
		return sessionError(command.kind, error);
	}
}

async function rebindSession(sessionId: SessionId, deps: CliDependencies): Promise<CliResponse> {
	const client = protocol(deps);
	try {
		await sessionsOrFail(deps, sessionId);
		const info = await client.getInfo();
		if (!info.documents?.grasshopper) {
			return cliError("session.rebind", {
				code: "document_conflict",
				message: "No Grasshopper document is active; cannot rebind.",
				retryable: false,
			});
		}
		let rebound: { session: SessionRecord; previous: Record<string, unknown> };
		await withLock(deps, sessionId, async () => {
			const result = await deps.sessions.rebind(sessionId, info.backend, info.documents!);
			await Journal.forSession(deps.stateRoot, sessionId).append({
				schemaVersion: 1,
				eventType: "session.rebound",
				eventId: crypto.randomUUID(),
				sessionId,
				occurredAt: new Date().toISOString(),
				previous: result.previous as unknown as Record<string, unknown>,
				next: result.session.binding as unknown as Record<string, unknown>,
			});
			rebound = result;
		});
		return sessionResponse("session.rebind", "Session rebound to the live documents.", rebound!.session);
	} catch (error) {
		return sessionError("session.rebind", error);
	} finally {
		await client.close().catch(() => {});
	}
}

export async function handleHistory(
	command: HistoryCommand,
	deps: CliDependencies,
): Promise<CliResponse> {
	try {
		const journal = Journal.forSession(deps.stateRoot, command.sessionId);
		await sessionsOrFail(deps, command.sessionId);
		switch (command.kind) {
			case "history.list": {
				const verification = await journal.verify();
				const edits = await journal.materialize();
				return cliResponse({
					ok: true,
					command: "history.list",
					sessionId: command.sessionId,
					outcome: "succeeded",
					message: `${edits.length} edit(s).`,
					data: {
						edits: edits as unknown as JsonValue,
						warnings: verification.errors as unknown as JsonValue,
					},
					artifacts: [],
					warnings: verification.errors.map((entry) => ({
						code: entry.code,
						message: entry.message,
					})),
					error: null,
				});
			}
			case "history.show": {
				const edit = await journal.find(command.editId);
				if (!edit) {
					return cliError("history.show", {
						code: "request_not_found",
						message: `Edit ${command.editId} does not exist in session ${command.sessionId}.`,
						retryable: false,
					}, { sessionId: command.sessionId });
				}
				return cliResponse({
					ok: true,
					command: "history.show",
					sessionId: command.sessionId,
					editId: command.editId,
					outcome: "succeeded",
					message: `Edit ${command.editId}.`,
					data: edit as unknown as JsonValue,
					artifacts: [],
					warnings: [],
					error: null,
				});
			}
			case "history.reconcile": {
				return reconcile(command.sessionId, command.editId, deps, journal);
			}
			case "history.diff": {
				const edit = await journal.find(command.editId);
				if (!edit) {
					return cliError("history.diff", {
						code: "request_not_found",
						message: `Edit ${command.editId} does not exist.`,
						retryable: false,
					}, { sessionId: command.sessionId });
				}
				if (!edit.diff) {
					return cliError("history.diff", {
						code: "request_not_found",
						message: `Edit ${command.editId} has no stored canvas diff.`,
						retryable: false,
					}, { sessionId: command.sessionId, editId: command.editId });
				}
				return cliResponse({
					ok: true,
					command: "history.diff",
					sessionId: command.sessionId,
					editId: command.editId,
					outcome: "succeeded",
					message: `Diff for ${command.editId}.`,
					data: edit.diff as unknown as JsonValue,
					artifacts: [],
					warnings: [],
					error: null,
				});
			}
			case "history.undo":
				return restoreHistory(command, "undo", deps, journal);
			case "history.redo":
				return restoreHistory(command, "redo", deps, journal);
			default: {
				const exhaustive: never = command;
				return cliError("history", {
					code: "invalid_command",
					message: `Unsupported history command ${(exhaustive as HistoryCommand).kind}.`,
					retryable: false,
				});
			}
		}
	} catch (error) {
		return sessionError(command.kind, error);
	}
}

async function reconcile(
	sessionId: SessionId,
	editId: EditId,
	deps: CliDependencies,
	journal: Journal,
): Promise<CliResponse> {
	const edit = await journal.find(editId);
	if (!edit) {
		return cliError("history.reconcile", {
			code: "request_not_found",
			message: `Edit ${editId} does not exist.`,
			retryable: false,
		}, { sessionId });
	}
	if (edit.state === "succeeded" || edit.state === "failed" || edit.state === "partial") {
		return cliResponse({
			ok: edit.state === "succeeded",
			command: "history.reconcile",
			sessionId,
			editId,
			outcome: edit.state,
			message: `Edit ${editId} is already terminal (${edit.state}).`,
			data: edit as unknown as JsonValue,
			artifacts: [],
			warnings: [],
			error: edit.error,
		});
	}

	const stored = await deps.sessions.readRequest(sessionId, edit.requestId);
	const client = protocol(deps);
	try {
		const session = await deps.sessions.read(sessionId);
		const status = await client.getRequestStatus(stored.requestId, stored.payloadSha256);
		const state = status.data?.state
			?? (status.error?.code === "request_not_found" ? "not_found" : undefined)
			?? (status.error?.code === "request_expired" ? "expired" : undefined);
		if (state && state !== "running" && state !== "not_found" && state !== "expired") {
			let outcome: "succeeded" | "failed" | "partial" | "unknown" = state === "succeeded" || state === "failed" || state === "partial"
				? state
				: "unknown";
			let error: HopperError | null = outcome === "succeeded" ? null : {
				code: outcome === "partial" ? "partial_mutation" : "operation_failed",
				message: `Reconciled from backend state ${state}.`,
				retryable: false,
			};
			const checkpoint = await reconcileCheckpoint(
				client,
				sessionId,
				edit,
				session,
				outcome,
				status.data?.cachedResponse?.data?.canvasDigestAfter ?? null,
				deps,
			);
			outcome = checkpoint.outcome;
			error = checkpoint.error ?? error;
			await journal.append(requestOutcomeEvent({
				sessionId,
				editId,
				requestId: edit.requestId,
				occurredAt: new Date().toISOString(),
				outcome,
				resultSummary: {
					source: "reconcile",
					backendState: state,
				},
				error,
				warnings: checkpoint.warnings,
				afterCheckpointId: checkpoint.afterCheckpointId,
				diff: checkpoint.diff,
				durationMs: 0,
			}));
			const updated = await journal.find(editId);
			return cliResponse({
				ok: outcome === "succeeded",
				command: "history.reconcile",
				sessionId,
				editId,
				outcome,
				message: `Reconciled edit ${editId} from backend state ${state}.`,
				data: updated as unknown as JsonValue,
				artifacts: [],
				warnings: checkpoint.warnings,
				error,
			});
		}

		if (state === "not_found" && status.backend.backendId === session.binding.backendId) {
			// The backend lost the entry (for example a service restart wiped the
			// in-memory ledger) but the identity matches: resend the exact stored
			// request so the deduplication ledger can make a fresh decision.
			const requester = deps.createRequester
				? deps.createRequester(deps.connection())
				: null;
			if (requester) {
				await requester.connect();
				try {
					const response: WireResponse<JsonValue> = await requester.request(
						withConnectionToken(stored.request, deps.connection()) as never,
						{ receiveTimeoutMs: deps.receiveTimeoutMs ?? 30_000 },
					);
					let outcome = response.outcome === "in_progress" ? "unknown" : response.outcome;
					let error = response.error;
					const executionDigest = response.data && typeof response.data === "object" && !Array.isArray(response.data)
						? response.data.canvasDigestAfter as string | null | undefined
						: null;
					const checkpoint = await reconcileCheckpoint(
						client,
						sessionId,
						edit,
						session,
						outcome,
						executionDigest ?? null,
						deps,
					);
					outcome = checkpoint.outcome;
					error = checkpoint.error ?? error;
					await journal.append(requestOutcomeEvent({
						sessionId,
						editId,
						requestId: edit.requestId,
						occurredAt: new Date().toISOString(),
						outcome,
						resultSummary: { source: "reconcile-resend" },
						error,
						warnings: checkpoint.warnings,
						afterCheckpointId: checkpoint.afterCheckpointId,
						diff: checkpoint.diff,
						durationMs: 0,
					}));
					const updated = await journal.find(editId);
					return cliResponse({
						ok: outcome === "succeeded",
						command: "history.reconcile",
						sessionId,
						editId,
						outcome,
						message: `Resent the original request; outcome ${outcome}.`,
						data: updated as unknown as JsonValue,
						artifacts: [],
						warnings: checkpoint.warnings,
						error,
					});
				} finally {
					await requester.close();
				}
			}
		}

		return cliResponse({
			ok: false,
			command: "history.reconcile",
			sessionId,
			editId,
			outcome: "unknown",
			message: state === "running"
				? "The backend still reports the request as running."
				: `The backend has no record of the request (state ${state ?? "unknown"}); the outcome stays unknown.`,
			data: edit as unknown as JsonValue,
			artifacts: [],
			warnings: [],
			error: {
				code: "outcome_unknown",
				message: "No terminal evidence is available yet.",
				retryable: true,
			},
		});
	} finally {
		await client.close().catch(() => {});
	}
}

async function reconcileCheckpoint(
	client: BackendClient,
	sessionId: SessionId,
	edit: MaterializedEdit,
	session: SessionRecord,
	outcome: "succeeded" | "failed" | "partial" | "unknown",
	executionDigest: string | null,
	deps: CliDependencies,
): Promise<{
	outcome: "succeeded" | "failed" | "partial" | "unknown";
	error: HopperError | null;
	warnings: HopperWarning[];
	afterCheckpointId: string | null;
	diff: CanvasDiff | null;
}> {
	const base = {
		outcome,
		error: null,
		warnings: [] as HopperWarning[],
		afterCheckpointId: null,
		diff: null,
	};
	if (outcome !== "succeeded" || !edit.beforeCheckpointId || edit.mutationScope !== "grasshopper") {
		return base;
	}
	try {
		const after = await captureSessionCheckpoint(client, sessionId, {
			backendId: session.binding.backendId,
			grasshopperDocumentId: session.binding.grasshopperDocumentId,
		}, deps);
		const before = await deps.checkpoints.read(sessionId, edit.beforeCheckpointId);
		const diff = diffCanvases(before.canonicalCanvas, after.canonicalCanvas ?? emptyCanvas());
		if (executionDigest && executionDigest !== after.canvasDigest) {
			const message = "The reconciled after-checkpoint digest differed from the execution response.";
			return {
				outcome: "partial",
				error: { code: "partial_mutation", message, retryable: false },
				warnings: [{ code: "checkpoint_race", message }],
				afterCheckpointId: after.checkpointId,
				diff,
			};
		}
		return { ...base, afterCheckpointId: after.checkpointId, diff };
	} catch {
		return {
			...base,
			warnings: [{
				code: "checkpoint_incomplete",
				message: "The mutation succeeded but reconciliation could not capture the after checkpoint.",
			}],
		};
	}
}

async function restoreHistory(
	command: Extract<HistoryCommand, { kind: "history.undo" | "history.redo" }>,
	direction: "undo" | "redo",
	deps: CliDependencies,
	journal: Journal,
): Promise<CliResponse> {
	const edit = await journal.find(command.editId);
	if (!edit) {
		return cliError(command.kind, {
			code: "request_not_found",
			message: `Edit ${command.editId} does not exist.`,
			retryable: false,
		}, { sessionId: command.sessionId });
	}
	if (edit.mutationScope === "rhino" || edit.mutationScope === "mixed") {
		return cliError(command.kind, {
			code: "unsupported_undo",
			message: `Durable ${direction} is not available for ${edit.mutationScope} edits.`,
			retryable: false,
		}, { sessionId: command.sessionId, editId: command.editId });
	}
	if (edit.state !== "succeeded") {
		return cliError(command.kind, {
			code: "unsupported_undo",
			message: `Edit ${command.editId} is ${edit.state}; ${direction} requires a successful Grasshopper mutation.`,
			retryable: false,
		}, { sessionId: command.sessionId, editId: command.editId });
	}
	const restoreFromId = direction === "undo" ? edit.beforeCheckpointId : edit.afterCheckpointId;
	const expectedLiveId = direction === "undo" ? edit.afterCheckpointId : edit.beforeCheckpointId;
	if (!restoreFromId || !expectedLiveId) {
		return cliError(command.kind, {
			code: "unsupported_undo",
			message: `Edit ${command.editId} is missing checkpoints required for ${direction}.`,
			retryable: false,
		}, { sessionId: command.sessionId, editId: command.editId });
	}

	const client = protocol(deps);
	try {
		let response: CliResponse | null = null;
		await withLock(deps, command.sessionId, async () => {
			const live = await sessionsOrFail(deps, command.sessionId);
			if (live.closedAt) {
				response = cliError(command.kind, {
					code: "session_locked",
					message: `Session ${command.sessionId} is closed.`,
					retryable: false,
				}, { sessionId: command.sessionId });
				return;
			}
			const info = await client.getInfo();
			if (info.backend.backendId !== live.binding.backendId) {
				response = cliError(command.kind, {
					code: "backend_conflict",
					message: "The backend restarted since this session was bound. Run 'hopper session rebind'.",
					retryable: false,
				}, { sessionId: command.sessionId });
				return;
			}
			await deps.checkpoints.verify(command.sessionId, restoreFromId);
			const stored = await deps.checkpoints.read(command.sessionId, restoreFromId);
			const expectedLive = await deps.checkpoints.read(command.sessionId, expectedLiveId);
			const envelope = envelopeForRestore(stored);
			const restoreRequest = attachMutationPayloadSha256(createWireRequest("restoreCheckpoint", {
				expectedBackendId: live.binding.backendId,
				expectedGrasshopperDocumentId: live.binding.grasshopperDocumentId,
				expectedLiveCanvasDigest: expectedLive.record.canvasDigest,
				checkpoint: envelope,
				transactionName: `hopper history ${direction}`,
			}, { requestId: createRequestId() })) as RestoreCheckpointRequest;
			const newEditId = await deps.sessions.reserveEditId(command.sessionId);
			await deps.sessions.writeRequest(command.sessionId, {
				schemaVersion: 1,
				requestId: restoreRequest.requestId,
				payloadSha256: restoreRequest.payloadSha256,
				request: restoreRequest,
			});
			await journal.append({
				schemaVersion: 1,
				eventType: "request.started",
				eventId: crypto.randomUUID(),
				sessionId: command.sessionId,
				editId: newEditId,
				requestId: restoreRequest.requestId,
				occurredAt: new Date().toISOString(),
				operation: command.kind,
				mutationScope: "grasshopper",
				inputSummary: { sourceEditId: command.editId, direction },
				backendId: live.binding.backendId,
				grasshopperDocumentId: live.binding.grasshopperDocumentId,
				rhinoDocumentId: live.binding.rhinoDocumentId,
				beforeCheckpointId: expectedLiveId,
			});
			let restored: Awaited<ReturnType<BackendClient["restoreCheckpoint"]>>;
			try {
				restored = await client.restoreCheckpoint(restoreRequest);
			} catch (cause) {
				const error: HopperError = cause instanceof HopperCoreError
					? cause.hopperError
					: {
						code: "outcome_unknown",
						message: cause instanceof Error ? cause.message : String(cause),
						retryable: true,
					};
				const outcome = error.code === "outcome_unknown" ? "unknown" : "failed";
				await journal.append(requestOutcomeEvent({
					sessionId: command.sessionId,
					editId: newEditId,
					requestId: restoreRequest.requestId,
					occurredAt: new Date().toISOString(),
					outcome,
					resultSummary: { sourceEditId: command.editId, direction },
					error,
					warnings: [],
					afterCheckpointId: null,
					diff: null,
					durationMs: 0,
				}));
				response = cliError(command.kind, error, { sessionId: command.sessionId, editId: newEditId });
				return;
			}
			if (restored.outcome !== "succeeded" || !restored.data) {
				const error = restored.error ?? {
					code: "operation_failed" as const,
					message: `${direction} failed.`,
					retryable: false,
				};
				await journal.append(requestOutcomeEvent({
					sessionId: command.sessionId,
					editId: newEditId,
					requestId: restoreRequest.requestId,
					occurredAt: new Date().toISOString(),
					outcome: restored.outcome === "in_progress" ? "unknown" : restored.outcome,
					resultSummary: { sourceEditId: command.editId, direction },
					error,
					warnings: [],
					afterCheckpointId: null,
					diff: null,
					durationMs: 0,
				}));
				response = cliError(command.kind, error, { sessionId: command.sessionId, editId: newEditId });
				return;
			}
			let afterCheckpointId: string | null = null;
			const warnings: HopperWarning[] = [];
			try {
				const after = await captureSessionCheckpoint(client, command.sessionId, {
					backendId: live.binding.backendId,
					grasshopperDocumentId: live.binding.grasshopperDocumentId,
				}, deps);
				afterCheckpointId = after.checkpointId;
			} catch {
				warnings.push({
					code: "checkpoint_incomplete",
					message: `The ${direction} succeeded but its after checkpoint could not be captured.`,
				});
			}
			await journal.append(requestOutcomeEvent({
				sessionId: command.sessionId,
				editId: newEditId,
				requestId: restoreRequest.requestId,
				occurredAt: new Date().toISOString(),
				outcome: "succeeded",
				resultSummary: { sourceEditId: command.editId, direction },
				error: null,
				warnings,
				afterCheckpointId,
				diff: null,
				durationMs: 0,
			}));
			if (afterCheckpointId) await journal.append({
				schemaVersion: 1,
				eventType: "history.restored",
				eventId: crypto.randomUUID(),
				sessionId: command.sessionId,
				editId: newEditId,
				sourceEditId: command.editId,
				requestId: restoreRequest.requestId,
				occurredAt: new Date().toISOString(),
				direction,
				beforeCheckpointId: expectedLiveId,
				afterCheckpointId,
				outcome: "succeeded",
			});
			response = cliResponse({
				ok: true,
				command: command.kind,
				sessionId: command.sessionId,
				editId: newEditId,
					requestId: restoreRequest.requestId,
				outcome: "succeeded",
				message: `${direction} of ${command.editId} restored checkpoint ${restoreFromId}.`,
				data: {
					sourceEditId: command.editId,
					restored: restored.data,
						afterCheckpointId,
				} as JsonValue,
				artifacts: [],
				warnings,
				error: null,
			});
		});
		return response!;
	} catch (error) {
		if (error instanceof HopperCoreError) {
			return cliError(command.kind, error.hopperError, {
				sessionId: command.sessionId,
				editId: command.editId,
			});
		}
		return sessionError(command.kind, error);
	} finally {
		await client.close().catch(() => {});
	}
}

function sessionResponse(command: string, message: string, session: SessionRecord): CliResponse {
	return cliResponse({
		ok: true,
		command,
		sessionId: session.sessionId,
		outcome: "succeeded",
		message,
		data: session as unknown as JsonValue,
		artifacts: [],
		warnings: [],
		error: null,
	});
}

function sessionError(command: string, error: unknown): CliResponse {
	if (error instanceof SessionStoreError) {
		return cliError(command, {
			code: error.code === "session_not_found" ? "session_not_found" : "invalid_input",
			message: error.message,
			retryable: false,
		});
	}
	if (error instanceof SessionLockError) {
		return cliError(command, {
			code: "session_locked",
			message: error.message,
			retryable: true,
		});
	}
	return cliError(command, {
		code: "internal_error",
		message: error instanceof Error ? error.message : String(error),
		retryable: false,
	});
}

function protocol(deps: CliDependencies): BackendClient {
	return (deps.createProtocolClient ?? ((connection) => createBackendClient(connection)))(deps.connection());
}

async function sessionsOrFail(deps: CliDependencies, sessionId: SessionId): Promise<SessionRecord> {
	return await deps.sessions.read(sessionId);
}

export async function withLock<T>(
	deps: CliDependencies,
	sessionId: SessionId,
	fn: () => Promise<T>,
): Promise<T> {
	return withSessionLock(sessionId, deps.stateRoot, fn);
}

export type { MaterializedEdit, GetRequestStatusResponse };
