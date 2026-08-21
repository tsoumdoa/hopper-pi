import type { TSchema } from "@sinclair/typebox";

export type DocumentTarget = {
	backendInstanceId: string;
	ghDocument: {
		path: string | null;
		runtimeId: string;
	} | null;
	rhinoDocument: {
		name: string;
		runtimeSerialNumber: number;
	} | null;
};

export type CliError = {
	code: string;
	message: string;
	retryable: boolean;
};

export type OperationSuccess<T> = {
	outcome: "succeeded";
	message: string;
	target: DocumentTarget;
	data: T;
	error: null;
};

export type OperationFailure<T = unknown> = {
	outcome: "failed" | "unknown";
	message: string;
	target: DocumentTarget | null;
	data: T | null;
	error: CliError;
};

export type OperationResult<T = unknown> =
	| OperationSuccess<T>
	| OperationFailure<T>;

export type PrototypeOperation<I = unknown, O = unknown> = {
	name: string;
	namespace: "gh" | "rh";
	publicName: string;
	description: string;
	inputSchema: TSchema;
	outputSchema: TSchema;
	mutates: boolean;
	execute(input: I, signal: AbortSignal): Promise<OperationResult<O>>;
};

export type CliSuccess<T> = {
	schemaVersion: 1;
	ok: true;
	command: string;
	operation?: string;
	outcome: "succeeded";
	message: string;
	target: DocumentTarget | null;
	data: T;
	error: null;
};

export type CliFailure<T = unknown> = {
	schemaVersion: 1;
	ok: false;
	command: string;
	operation?: string;
	outcome: "failed" | "unknown";
	message: string;
	target: DocumentTarget | null;
	data: T | null;
	error: CliError;
};

export type CliResponse<T = unknown> = CliSuccess<T> | CliFailure<T>;

export const CLI_EXIT = {
	SUCCESS: 0,
	INVALID_INPUT: 2,
	BACKEND_UNAVAILABLE: 3,
	OPERATION_FAILED: 4,
	MUTATION_UNKNOWN: 5,
	INTERNAL_ERROR: 70,
} as const;

export const ERROR_CODE = {
	INVALID_COMMAND: "INVALID_COMMAND",
	JSON_REQUIRED: "JSON_REQUIRED",
	INPUT_SOURCE_REQUIRED: "INPUT_SOURCE_REQUIRED",
	MULTIPLE_INPUT_SOURCES: "MULTIPLE_INPUT_SOURCES",
	INPUT_TOO_LARGE: "INPUT_TOO_LARGE",
	INPUT_READ_FAILED: "INPUT_READ_FAILED",
	INVALID_UTF8: "INVALID_UTF8",
	INVALID_JSON: "INVALID_JSON",
	INPUT_OBJECT_REQUIRED: "INPUT_OBJECT_REQUIRED",
	INPUT_SCHEMA_INVALID: "INPUT_SCHEMA_INVALID",
	UNKNOWN_OPERATION: "UNKNOWN_OPERATION",
	BACKEND_UNAVAILABLE: "BACKEND_UNAVAILABLE",
	AUTHENTICATION_FAILED: "AUTHENTICATION_FAILED",
	BACKEND_TIMEOUT: "BACKEND_TIMEOUT",
	MALFORMED_BACKEND_RESPONSE: "MALFORMED_BACKEND_RESPONSE",
	OPERATION_FAILED: "OPERATION_FAILED",
	MUTATION_OUTCOME_UNKNOWN: "MUTATION_OUTCOME_UNKNOWN",
	INTERRUPTED: "INTERRUPTED",
	INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export function cliSuccess<T>(
	command: string,
	message: string,
	data: T,
	target: DocumentTarget | null = null,
	operation?: string,
): CliSuccess<T> {
	return {
		schemaVersion: 1,
		ok: true,
		command,
		...(operation ? { operation } : {}),
		outcome: "succeeded",
		message,
		target,
		data,
		error: null,
	};
}

export function cliFailure(
	command: string,
	code: string,
	message: string,
	options: {
		outcome?: "failed" | "unknown";
		retryable?: boolean;
		target?: DocumentTarget | null;
		data?: unknown;
		operation?: string;
	} = {},
): CliFailure {
	return {
		schemaVersion: 1,
		ok: false,
		command,
		...(options.operation ? { operation: options.operation } : {}),
		outcome: options.outcome ?? "failed",
		message,
		target: options.target ?? null,
		data: options.data ?? null,
		error: {
			code,
			message,
			retryable: options.retryable ?? false,
		},
	};
}
