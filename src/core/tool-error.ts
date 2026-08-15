import type { HopperResult } from "./tool-contract.js";

export const HOPPER_ERROR_CODES = [
	"invalid_input",
	"backend_offline",
	"backend_error",
	"cancelled",
	"consent_required",
	"consent_denied",
	"unsupported_client",
	"unknown_outcome",
	"internal_error",
] as const;

export type HopperErrorCode = (typeof HOPPER_ERROR_CODES)[number];

export type HopperErrorDetails = {
	error: {
		code: HopperErrorCode;
		message: string;
		retryable: boolean;
	};
};

export class HopperToolError extends Error {
	constructor(
		public readonly code: HopperErrorCode,
		message: string,
		public readonly retryable = false,
	) {
		super(message);
		this.name = "HopperToolError";
	}
}

export function isAbortError(error: unknown): boolean {
	return error instanceof Error && (error.name === "AbortError" || error.message === "The operation was aborted");
}

export function errorResult(
	code: HopperErrorCode,
	message: string,
	options: { retryable?: boolean; details?: Record<string, unknown> } = {},
): HopperResult<HopperErrorDetails & Record<string, unknown>> {
	return {
		content: [{ type: "text", text: message }],
		details: {
			...options.details,
			error: { code, message, retryable: options.retryable === true },
		},
		isError: true,
	};
}

export function resultFromThrown(error: unknown): HopperResult {
	if (isAbortError(error)) {
		return errorResult("cancelled", "Hopper tool call cancelled.", { retryable: true });
	}
	if (error instanceof HopperToolError) {
		return errorResult(error.code, error.message, { retryable: error.retryable });
	}
	const message = error instanceof Error ? error.message : String(error);
	return errorResult("internal_error", `Hopper tool failed: ${message}`);
}
