import type { JsonObject } from "./contracts.js";

export const HOPPER_ERROR_CODES = [
	"invalid_command",
	"invalid_input",
	"operation_not_found",
	"operation_not_batchable",
	"backend_offline",
	"authentication_failed",
	"protocol_mismatch",
	"backend_busy",
	"request_id_conflict",
	"request_expired",
	"request_not_found",
	"session_not_found",
	"session_locked",
	"backend_conflict",
	"document_conflict",
	"canvas_conflict",
	"unsupported_undo",
	"operation_failed",
	"partial_mutation",
	"outcome_unknown",
	"journal_corrupt",
	"internal_error",
] as const;

export type HopperErrorCode = (typeof HOPPER_ERROR_CODES)[number];

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

export class HopperCoreError extends Error {
	readonly hopperError: HopperError;

	constructor(error: HopperError) {
		super(error.message);
		this.name = "HopperCoreError";
		this.hopperError = error;
	}
}

export function toHopperError(
	error: unknown,
	fallbackCode: HopperErrorCode = "operation_failed",
): HopperError {
	if (error instanceof HopperCoreError) return error.hopperError;
	return {
		code: fallbackCode,
		message: error instanceof Error ? error.message : String(error),
		retryable: false,
	};
}
