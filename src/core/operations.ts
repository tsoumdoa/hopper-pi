import { Value } from "@sinclair/typebox/value";
import type {
	ArtifactWriter,
	BackendAction,
	BackendClient,
	ExecuteActionsResponse,
	JsonObject,
	JsonSchema,
	JsonValue,
	MutationScope,
	OperationResult,
	ProgressEvent,
	RequestId,
	SessionBinding,
} from "./contracts.js";
import {
	HOPPER_ERROR_CODES,
	HopperCoreError,
	toHopperError,
	type HopperError,
} from "./errors.js";

export type PreparedMutation<T extends JsonValue = JsonValue> = {
	scope: Exclude<MutationScope, "none">;
	actions: BackendAction[];
	finish(response: ExecuteActionsResponse): OperationResult<T>;
};

export type OperationContext = {
	signal: AbortSignal;
	requestId: RequestId;
	session: SessionBinding | null;
	/** Set by the caller after applying its capture-consent policy. */
	captureAllowed?: boolean;
	backend: BackendClient;
	artifacts: ArtifactWriter;
	reportProgress(event: ProgressEvent): void;
	now(): Date;
};

export type HopperOperation<I extends JsonValue, O extends JsonValue> = {
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
): HopperOperation<I, O> {
	return operation;
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

type ValidationIssue = {
	path: string;
	message: string;
	type: number;
};

function validationIssues(schema: JsonSchema, value: unknown): ValidationIssue[] {
	return [...Value.Errors(schema, value)].map((issue) => ({
		path: issue.path || "",
		message: issue.message,
		type: issue.type,
	}));
}

function invalidInputError(operation: string, issues: ValidationIssue[]): HopperCoreError {
	return new HopperCoreError({
		code: "invalid_input",
		message: `Input for operation "${operation}" did not match its schema.`,
		retryable: false,
		details: {
			operation,
			issues: issues.map((issue) => ({
				path: issue.path,
				message: issue.message,
				type: issue.type,
			})),
		},
	});
}

function failedResult(error: HopperError): OperationResult<JsonValue> {
	return {
		outcome: "failed",
		message: error.message,
		data: null,
		warnings: [],
		artifacts: [],
		error,
	};
}

function containedErrorResult(error: unknown): OperationResult<JsonValue> {
	const hopperError = toHopperError(error);
	const outcome = hopperError.code === "outcome_unknown"
		? "unknown"
		: hopperError.code === "partial_mutation"
			? "partial"
			: "failed";
	return {
		outcome,
		message: hopperError.message,
		data: null,
		warnings: [],
		artifacts: [],
		error: hopperError,
	};
}

function internalResult(operation: string, message: string, details?: JsonObject) {
	return failedResult({
		code: "internal_error",
		message,
		retryable: false,
		details: { operation, ...details },
	});
}

const operationOutcomes = new Set(["succeeded", "failed", "partial", "unknown", "in_progress"]);
const hopperErrorCodes = new Set<string>(HOPPER_ERROR_CODES);
const artifactKinds = new Set(["viewport_capture", "checkpoint", "diagnostic"]);

function isJsonValue(value: unknown): value is JsonValue {
	if (value === null || typeof value === "string" || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(isJsonValue);
	if (!value || typeof value !== "object") return false;
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return false;
	return Object.values(value).every(isJsonValue);
}

function isJsonObject(value: unknown): value is JsonObject {
	return !!value && typeof value === "object" && !Array.isArray(value) && isJsonValue(value);
}

function isValidError(error: unknown): error is HopperError {
	if (!error || typeof error !== "object" || Array.isArray(error)) return false;
	const record = error as Record<string, unknown>;
	return typeof record.code === "string"
		&& hopperErrorCodes.has(record.code)
		&& typeof record.message === "string"
		&& typeof record.retryable === "boolean"
		&& (record.details === undefined || isJsonObject(record.details));
}

function isValidWarning(warning: unknown): boolean {
	if (!warning || typeof warning !== "object" || Array.isArray(warning)) return false;
	const record = warning as Record<string, unknown>;
	return typeof record.code === "string"
		&& typeof record.message === "string"
		&& (record.details === undefined || isJsonObject(record.details));
}

function isValidArtifact(artifact: unknown): boolean {
	if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) return false;
	const record = artifact as Record<string, unknown>;
	return typeof record.artifactId === "string"
		&& typeof record.kind === "string"
		&& artifactKinds.has(record.kind)
		&& typeof record.path === "string"
		&& typeof record.mediaType === "string"
		&& typeof record.byteLength === "number"
		&& Number.isInteger(record.byteLength)
		&& record.byteLength >= 0
		&& typeof record.sha256 === "string";
}

function validateResult(
	operation: HopperOperation<JsonValue, JsonValue>,
	result: OperationResult<JsonValue>,
): OperationResult<JsonValue> {
	if (!result || typeof result !== "object") {
		return internalResult(operation.name, `Operation "${operation.name}" returned no result.`);
	}
	if (!operationOutcomes.has(result.outcome)) {
		return internalResult(
			operation.name,
			`Operation "${operation.name}" returned an invalid outcome.`,
		);
	}
	if (result.outcome === "in_progress") {
		return internalResult(
			operation.name,
			`Operation "${operation.name}" returned in_progress outside a request-status response.`,
		);
	}
	if (typeof result.message !== "string") {
		return internalResult(
			operation.name,
			`Operation "${operation.name}" returned a non-string message.`,
		);
	}

	if (result.outcome === "succeeded" && result.error !== null) {
		return internalResult(
			operation.name,
			`Operation "${operation.name}" returned succeeded with an error.`,
		);
	}

	if (
		(result.outcome === "failed" || result.outcome === "partial" || result.outcome === "unknown") &&
		result.error === null
	) {
		return internalResult(
			operation.name,
			`Operation "${operation.name}" returned ${result.outcome} without an error.`,
		);
	}

	if (
		!Array.isArray(result.warnings) ||
		!result.warnings.every(isValidWarning) ||
		!Array.isArray(result.artifacts) ||
		!result.artifacts.every(isValidArtifact)
	) {
		return internalResult(
			operation.name,
			`Operation "${operation.name}" returned malformed warnings or artifacts.`,
		);
	}
	if (result.error !== null && !isValidError(result.error)) {
		return internalResult(
			operation.name,
			`Operation "${operation.name}" returned a malformed error.`,
		);
	}

	if (result.data !== null) {
		if (!isJsonValue(result.data)) {
			return internalResult(
				operation.name,
				`Operation "${operation.name}" returned non-JSON data.`,
			);
		}
		const issues = validationIssues(operation.outputSchema, result.data);
		if (issues.length > 0) {
			return internalResult(
				operation.name,
				`Operation "${operation.name}" returned data that did not match its output schema.`,
				{
					issues: issues.map((issue) => ({
						path: issue.path,
						message: issue.message,
						type: issue.type,
					})),
				},
			);
		}
	}

	return result;
}

export class OperationRegistry {
	readonly #operations = new Map<string, HopperOperation<JsonValue, JsonValue>>();

	register<I extends JsonValue, O extends JsonValue>(operation: HopperOperation<I, O>): void {
		if (this.#operations.has(operation.name)) {
			throw new HopperCoreError({
				code: "invalid_command",
				message: `Operation "${operation.name}" is already registered.`,
				retryable: false,
				details: { operation: operation.name },
			});
		}
		if (operation.possibleScopes.length === 0) {
			throw new HopperCoreError({
				code: "invalid_command",
				message: `Operation "${operation.name}" must declare at least one possible scope.`,
				retryable: false,
				details: { operation: operation.name },
			});
		}
		this.#operations.set(
			operation.name,
			operation as unknown as HopperOperation<JsonValue, JsonValue>,
		);
	}

	get(name: string): HopperOperation<JsonValue, JsonValue> | undefined {
		return this.#operations.get(name);
	}

	list(): readonly OperationCatalogEntry[] {
		return [...this.#operations.values()].map((operation) => ({
			name: operation.name,
			version: operation.version,
			description: operation.description,
			group: operation.group,
			possibleScopes: [...operation.possibleScopes],
			batchable: operation.prepareMutation !== undefined,
		}));
	}

	schema(name: string): OperationSchemaRecord | undefined {
		const operation = this.#operations.get(name);
		if (!operation) return undefined;
		const entry = this.list().find((candidate) => candidate.name === name)!;
		return {
			...entry,
			inputSchema: operation.inputSchema as unknown as JsonObject,
			outputSchema: operation.outputSchema as unknown as JsonObject,
		};
	}

	resolve(name: string, input: unknown): ResolvedOperationCall {
		const operation = this.#operations.get(name);
		if (!operation) {
			throw new HopperCoreError({
				code: "operation_not_found",
				message: `Operation "${name}" was not found.`,
				retryable: false,
				details: { operation: name },
			});
		}

		const issues = validationIssues(operation.inputSchema, input);
		if (issues.length > 0) throw invalidInputError(name, issues);

		const validatedInput = input as JsonValue;
		let scope: MutationScope;
		try {
			scope = operation.classifyScope(validatedInput);
		} catch (error) {
			throw invalidInputError(name, [{
				path: "",
				message: error instanceof Error ? error.message : String(error),
				type: 0,
			}]);
		}

		if (!operation.possibleScopes.includes(scope)) {
			throw new HopperCoreError({
				code: "internal_error",
				message: `Operation "${name}" classified an undeclared scope "${scope}".`,
				retryable: false,
				details: { operation: name, scope },
			});
		}

		return { operation, input: validatedInput, scope };
	}

	async execute(
		call: ResolvedOperationCall,
		context: OperationContext,
	): Promise<OperationResult<JsonValue>> {
		try {
			return validateResult(
				call.operation,
				await call.operation.execute(call.input, context),
			);
		} catch (error) {
			return containedErrorResult(error);
		}
	}
}
