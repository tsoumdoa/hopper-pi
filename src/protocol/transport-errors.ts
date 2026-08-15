import type { HopperError } from "../core/errors.js";

export type TransportSendState = "not_sent" | "possibly_sent";

export function mapTransportError(
	error: unknown,
	sendState: TransportSendState,
	requestKind: "read" | "mutation",
): HopperError {
	const message = error instanceof Error ? error.message : String(error);
	if (requestKind === "mutation" && sendState === "possibly_sent") {
		return {
			code: "outcome_unknown",
			message,
			retryable: true,
			details: { sendState, requestKind },
		};
	}
	return {
		code: "backend_offline",
		message,
		retryable: true,
		details: { sendState, requestKind },
	};
}

