import type {
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
import { acquireSessionLock, SessionLockError } from "../session/lock.js";
import { createBackendClient, type BackendClient } from "../protocol/backend-client.js";
import type { GetRequestStatusResponse, WireResponse } from "../protocol/wire.js";
import { withConnectionToken } from "../infra/connection.js";

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
			ok: true,
			command: "history.reconcile",
			sessionId,
			editId,
			outcome: edit.state,
			message: `Edit ${editId} is already terminal (${edit.state}).`,
			data: edit as unknown as JsonValue,
			artifacts: [],
			warnings: [],
			error: null,
		});
	}

	const stored = await deps.sessions.readRequest(sessionId, edit.requestId);
	const client = protocol(deps);
	try {
		const session = await deps.sessions.read(sessionId);
		const status = await client.getRequestStatus(stored.requestId, stored.payloadSha256);
		const state = status.data?.state;
		if (state && state !== "running" && state !== "not_found" && state !== "expired") {
			const outcome = state === "succeeded" || state === "failed" || state === "partial"
				? state
				: "unknown";
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
				error: outcome === "succeeded" ? null : {
					code: outcome === "partial" ? "partial_mutation" : "operation_failed",
					message: `Reconciled from backend state ${state}.`,
					retryable: false,
				},
				warnings: [],
				afterCheckpointId: null,
				diff: null,
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
				warnings: [],
				error: null,
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
					const outcome = response.outcome === "in_progress" ? "unknown" : response.outcome;
					await journal.append(requestOutcomeEvent({
						sessionId,
						editId,
						requestId: edit.requestId,
						occurredAt: new Date().toISOString(),
						outcome,
						resultSummary: { source: "reconcile-resend" },
						error: response.error,
						warnings: [],
						afterCheckpointId: null,
						diff: null,
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
						warnings: [],
						error: response.error,
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
	const { withSessionLock } = await import("../session/lock.js");
	return withSessionLock(sessionId, deps.stateRoot, fn);
}

export type { MaterializedEdit, GetRequestStatusResponse };
