import { createInterface } from "node:readline";
import { createReadStream, existsSync } from "node:fs";
import type {
	CanvasDiff,
	EditId,
	JsonObject,
	MutationScope,
	OperationOutcome,
	RequestId,
	SessionId,
} from "../core/contracts.js";
import type { HopperError, HopperWarning } from "../core/errors.js";
import { appendLineDurable, journalPath, newEventId } from "./paths.js";

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
		backendId: string;
		grasshopperDocumentId: string;
		rhinoDocumentId: string | null;
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
		previous: Record<string, unknown>;
		next: Record<string, unknown>;
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
	warnings: HopperWarning[];
	durationMs: number | null;
};

const TERMINAL_OUTCOMES = new Set<OperationOutcome>(["succeeded", "failed", "partial"]);

/**
 * Append-only journal. `request.started` is flushed before the mutation is
 * sent; `request.outcome` records every observed outcome. Replay permits
 * pending -> unknown -> terminal, the latest valid outcome wins, and a terminal
 * outcome that flips to a different one is corruption.
 */
export class Journal {
	constructor(
		readonly sessionId: SessionId,
		readonly path: string,
	) {}

	static forSession(stateRoot: string, sessionId: SessionId): Journal {
		return new Journal(sessionId, journalPath(stateRoot, sessionId));
	}

	async append(event: HistoryEvent, options: { flush?: boolean } = {}): Promise<void> {
		const { mkdir } = await import("node:fs/promises");
		const { dirname } = await import("node:path");
		await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
		const line = JSON.stringify(event);
		if (options.flush === false) {
			const { appendFile } = await import("node:fs/promises");
			await appendFile(this.path, `${line}\n`, "utf8");
			return;
		}
		await appendLineDurable(this.path, line);
	}

	async *readAll(): AsyncIterable<HistoryEvent> {
		if (!existsSync(this.path)) return;
		const stream = createReadStream(this.path, "utf8");
		const lines = createInterface({ input: stream, crlfDelay: Infinity });
		let last = "";
		try {
			for await (const line of lines) {
				last = line;
				if (line.trim().length === 0) continue;
				yield JSON.parse(line) as HistoryEvent;
			}
		} finally {
			stream.destroy();
			void last;
		}
	}

	/**
	 * Reads raw lines and reports truncation of the final line. Any corruption
	 * before the final line is a hard error.
	 */
	async readRaw(): Promise<{ events: HistoryEvent[]; truncatedFinalLine: boolean }> {
		if (!existsSync(this.path)) return { events: [], truncatedFinalLine: false };
		const { readFile } = await import("node:fs/promises");
		const contents = await readFile(this.path, "utf8");
		const lines = contents.split("\n");
		if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
		const events: HistoryEvent[] = [];
		let truncated = false;
		for (let index = 0; index < lines.length; index++) {
			const line = lines[index]!;
			if (line.trim().length === 0) continue;
			try {
				events.push(JSON.parse(line) as HistoryEvent);
			} catch {
				if (index === lines.length - 1) {
					truncated = true;
					continue;
				}
				throw new JournalCorruptError(
					`Journal line ${index + 1} of session ${this.sessionId} is corrupt.`,
				);
			}
		}
		return { events, truncatedFinalLine: truncated };
	}

	async materialize(): Promise<MaterializedEdit[]> {
		const { events } = await this.readRaw();
		const edits = new Map<EditId, MaterializedEdit>();
		for (const event of events) {
			switch (event.eventType) {
				case "request.started": {
					if (edits.has(event.editId)) {
						throw new JournalCorruptError(`Edit ${event.editId} started twice.`);
					}
					edits.set(event.editId, {
						editId: event.editId,
						requestId: event.requestId,
						operation: event.operation,
						mutationScope: event.mutationScope,
						state: "pending",
						startedAt: event.occurredAt,
						finishedAt: null,
						inputSummary: event.inputSummary,
						resultSummary: null,
						error: null,
						beforeCheckpointId: event.beforeCheckpointId,
						afterCheckpointId: null,
						diff: null,
						warnings: [],
						durationMs: null,
					});
					break;
				}
				case "request.outcome": {
					const edit = edits.get(event.editId);
					if (!edit) {
						throw new JournalCorruptError(
							`Outcome for unknown edit ${event.editId}.`,
						);
					}
					if (TERMINAL_OUTCOMES.has(edit.state as OperationOutcome)) {
						if (event.outcome !== edit.state) {
							throw new JournalCorruptError(
								`Edit ${event.editId} already ended ${edit.state}; refusing ${event.outcome}.`,
							);
						}
						continue;
					}
					edit.state = event.outcome;
					edit.finishedAt = event.occurredAt;
					edit.resultSummary = event.resultSummary;
					edit.error = event.error;
					edit.warnings = event.warnings;
					edit.afterCheckpointId = event.afterCheckpointId;
					edit.diff = event.diff;
					edit.durationMs = event.durationMs;
					break;
				}
				default:
					break;
			}
		}
		return [...edits.values()];
	}

	async find(editId: EditId): Promise<MaterializedEdit | null> {
		const edits = await this.materialize();
		return edits.find((edit) => edit.editId === editId) ?? null;
	}

	async verify(): Promise<{ ok: boolean; errors: HopperError[]; truncatedFinalLine: boolean }> {
		try {
			const { truncatedFinalLine } = await this.readRaw();
			await this.materialize();
			return {
				ok: true,
				errors: truncatedFinalLine
					? [{
						code: "journal_corrupt",
						message: "The final journal line is truncated and was ignored.",
						retryable: false,
					}]
					: [],
				truncatedFinalLine,
			};
		} catch (error) {
			if (error instanceof JournalCorruptError) {
				return {
					ok: false,
					errors: [{ code: "journal_corrupt", message: error.message, retryable: false }],
					truncatedFinalLine: false,
				};
			}
			throw error;
		}
	}
}

export class JournalCorruptError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "JournalCorruptError";
	}
}

export function requestStartedEvent(fields: {
	sessionId: SessionId;
	editId: EditId;
	requestId: RequestId;
	occurredAt: string;
	operation: string;
	mutationScope: MutationScope;
	inputSummary: JsonObject;
	backendId: string;
	grasshopperDocumentId: string;
	rhinoDocumentId: string | null;
	beforeCheckpointId: string | null;
}): HistoryEvent {
	return { schemaVersion: 1, eventType: "request.started", eventId: newEventId(), ...fields };
}

export function requestOutcomeEvent(fields: {
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
}): HistoryEvent {
	return { schemaVersion: 1, eventType: "request.outcome", eventId: newEventId(), ...fields };
}
