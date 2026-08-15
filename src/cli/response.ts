import type { ArtifactRecord, JsonValue, OperationOutcome } from "../core/contracts.js";
import type { HopperError, HopperWarning } from "../core/errors.js";

export type CliResponse<T extends JsonValue = JsonValue> = {
	schemaVersion: 1;
	ok: boolean;
	command: string;
	operation?: string;
	sessionId?: string;
	requestId?: string;
	editId?: string;
	outcome: OperationOutcome;
	message: string;
	data: T | null;
	artifacts: ArtifactRecord[];
	warnings: HopperWarning[];
	error: HopperError | null;
};

export const CLI_EXIT_CODES = {
	success: 0,
	usage: 2,
	backend: 3,
	conflict: 4,
	operationFailure: 5,
	unknown: 6,
	internal: 70,
} as const;

const CONFLICT_ERROR_CODES = new Set([
	"request_id_conflict",
	"request_expired",
	"request_not_found",
	"session_not_found",
	"session_locked",
	"backend_conflict",
	"document_conflict",
	"canvas_conflict",
	"unsupported_undo",
]);

const BACKEND_ERROR_CODES = new Set([
	"backend_offline",
	"authentication_failed",
	"protocol_mismatch",
	"backend_busy",
]);

const USAGE_ERROR_CODES = new Set([
	"invalid_command",
	"invalid_input",
	"operation_not_found",
	"operation_not_batchable",
]);

export function mapErrorToExitCode(error: HopperError): number {
	if (error.code === "outcome_unknown") return CLI_EXIT_CODES.unknown;
	if (CONFLICT_ERROR_CODES.has(error.code)) return CLI_EXIT_CODES.conflict;
	if (BACKEND_ERROR_CODES.has(error.code)) return CLI_EXIT_CODES.backend;
	if (USAGE_ERROR_CODES.has(error.code)) return CLI_EXIT_CODES.usage;
	if (error.code === "journal_corrupt") return CLI_EXIT_CODES.internal;
	return CLI_EXIT_CODES.operationFailure;
}

export function mapOutcomeToExitCode(response: CliResponse): number {
	if (response.ok) return CLI_EXIT_CODES.success;
	if (response.outcome === "unknown") return CLI_EXIT_CODES.unknown;
	if (response.error) return mapErrorToExitCode(response.error);
	return CLI_EXIT_CODES.operationFailure;
}

export function cliResponse<T extends JsonValue>(response: Omit<CliResponse<T>, "schemaVersion">): CliResponse<T> {
	return { schemaVersion: 1, ...response };
}

export function cliError(
	command: string,
	error: HopperError,
	options: { operation?: string; message?: string; sessionId?: string; editId?: string } = {},
): CliResponse {
	return {
		schemaVersion: 1,
		ok: false,
		command,
		operation: options.operation,
		sessionId: options.sessionId,
		editId: options.editId,
		outcome: error.code === "outcome_unknown" ? "unknown" : "failed",
		message: options.message ?? error.message,
		data: null,
		artifacts: [],
		warnings: [],
		error,
	};
}
