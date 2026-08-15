import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type {
	ArtifactRecord,
	ArtifactWriter,
	BackendClient,
	ExecuteActionsResponse,
	JsonObject,
	JsonValue,
	RequestId,
} from "../../core/contracts.js";
import type { OperationContext } from "../../core/operations.js";
import { DEFAULT_ARTIFACT_ROOT, createArtifactWriter } from "../../infra/artifact-writer.js";
import { submitCommand } from "../../infra/command-dispatch.js";
import { withRequester } from "../../infra/request-helpers.js";
import { executeApplyGraph } from "../../services/gh-apply-graph.js";
import { isRhinoVisualCaptureAllowed } from "../../services/rhino-visual-consent.js";
import type { ApplyGraphInput, ApplyGraphResult } from "../../types/gh-apply-graph.js";
import type { CommandAction } from "../../types/commands.js";
import type { PiOperationContextFactoryArgs } from "./operation-adapter.js";

const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

type LegacyContextDependencies = {
	query<T extends JsonValue>(request: JsonObject): Promise<T>;
	executeApplyGraph(input: ApplyGraphInput): Promise<ApplyGraphResult>;
	submitCommand(action: CommandAction, params: JsonObject): Promise<{ jobId: string }>;
	captureAllowed(): boolean;
	artifactWriter: ArtifactWriter;
	now(): Date;
};

function asJsonValue(value: unknown): JsonValue {
	return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function encodeTimestamp(timestamp: number): string {
	let remaining = Math.max(0, Math.trunc(timestamp));
	let encoded = "";
	for (let index = 0; index < 10; index++) {
		encoded = CROCKFORD_BASE32[remaining % 32] + encoded;
		remaining = Math.floor(remaining / 32);
	}
	return encoded;
}

/** Generate a req_ ID with a 26-character ULID payload. */
export function createLegacyRequestId(now: Date = new Date()): RequestId {
	const entropy = randomBytes(16);
	let randomPart = "";
	for (let index = 0; index < 16; index++) {
		randomPart += CROCKFORD_BASE32[entropy[index]! & 31];
	}
	return `req_${encodeTimestamp(now.getTime())}${randomPart}`;
}

export function createTemporaryArtifactWriter(
	rootDirectory: string = DEFAULT_ARTIFACT_ROOT,
): ArtifactWriter {
	return createArtifactWriter(rootDirectory);
}

function operationFailure(message: string): ExecuteActionsResponse {
	return {
		outcome: "failed",
		data: null,
		error: { code: "operation_failed", message, retryable: false },
	};
}

function unknownQueuedResult(
	message: string,
	jobIds: readonly string[],
	actionCount: number,
): ExecuteActionsResponse {
	return {
		outcome: "unknown",
		data: null,
		error: {
			code: "outcome_unknown",
			message,
			retryable: false,
			details: {
				submittedJobIds: [...jobIds],
				submittedCount: jobIds.length,
				actionCount,
				legacyQueue: true,
			},
		},
	};
}

function finishLegacyApplyGraph(result: ApplyGraphResult): ExecuteActionsResponse {
	if (result.timedOut) {
		return {
			outcome: "unknown",
			data: null,
			error: {
				code: "outcome_unknown",
				message: "Grasshopper graph apply timed out; the legacy backend cannot prove its terminal state.",
				retryable: false,
			},
		};
	}
	if (!result.ok) {
		const message = result.structuralErrors[0]?.message || "Grasshopper graph apply failed.";
		return {
			outcome: "failed",
			data: null,
			error: {
				code: "operation_failed",
				message,
				retryable: false,
				details: { structuralErrors: asJsonValue(result.structuralErrors) },
			},
		};
	}
	return {
		outcome: "succeeded",
		data: asJsonValue({
			counts: result.counts,
			refs: result.refs,
			runtimeMessages: result.runtimeMessages,
			overlaps: result.overlaps,
		}),
		error: null,
	};
}

function readCommand(action: JsonObject): { action: CommandAction; params: JsonObject } | null {
	const command = action.command;
	if (!command || Array.isArray(command) || typeof command !== "object") return null;
	if (typeof command.action !== "string") return null;
	const params = command.params;
	if (!params || Array.isArray(params) || typeof params !== "object") return null;
	return { action: command.action as CommandAction, params };
}

function readActions(request: JsonObject): JsonObject[] | null {
	if (!Array.isArray(request.actions)) return null;
	const actions = request.actions.filter(
		(action): action is JsonObject => Boolean(action) && !Array.isArray(action) && typeof action === "object",
	);
	return actions.length === request.actions.length ? actions : null;
}

export function createLegacyBackendClient(
	dependencies: Pick<LegacyContextDependencies, "query" | "executeApplyGraph" | "submitCommand">,
): BackendClient {
	return {
		query: async <T extends JsonValue>(request: JsonObject, signal?: AbortSignal): Promise<T> => {
			if (signal?.aborted) throw signal.reason ?? new Error("Operation aborted.");
			return dependencies.query<T>(request);
		},
		async executeActions(request, signal): Promise<ExecuteActionsResponse> {
			const actions = readActions(request);
			if (!actions || actions.length === 0) return operationFailure("No backend actions were provided.");

			const submittedJobIds: string[] = [];
			for (const action of actions) {
				if (signal?.aborted) {
					if (submittedJobIds.length > 0) {
						return unknownQueuedResult(
							"Command submission was aborted after one or more legacy jobs were queued.",
							submittedJobIds,
							actions.length,
						);
					}
					return operationFailure("Command submission was aborted before any work was queued.");
				}

				try {
					if (action.kind === "applyGraph") {
						if (actions.length !== 1 || submittedJobIds.length > 0) {
							return operationFailure("The legacy bridge cannot mix applyGraph with queued command actions.");
						}
						return finishLegacyApplyGraph(
							await dependencies.executeApplyGraph(action.input as ApplyGraphInput),
						);
					}

					if (action.kind !== "command") {
						return operationFailure(`The legacy bridge does not support backend action kind "${action.kind}".`);
					}
					const command = readCommand(action);
					if (!command) return operationFailure("A command backend action was malformed.");
					const submitted = await dependencies.submitCommand(command.action, command.params);
					submittedJobIds.push(submitted.jobId);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					if (submittedJobIds.length > 0) {
						return unknownQueuedResult(
							`A legacy command submission failed after work was queued: ${message}`,
							submittedJobIds,
							actions.length,
						);
					}
					return operationFailure(message);
				}
			}

			return unknownQueuedResult(
				"Legacy command jobs were queued, but queue acceptance is not terminal success.",
				submittedJobIds,
				actions.length,
			);
		},
	};
}

function defaultDependencies(): LegacyContextDependencies {
	return {
		query: <T extends JsonValue>(request: JsonObject) => withRequester(
			(requester) => requester.request<T>(request),
		),
		executeApplyGraph,
		submitCommand: (action, params) => submitCommand(action, params),
		captureAllowed: isRhinoVisualCaptureAllowed,
		artifactWriter: createTemporaryArtifactWriter(),
		now: () => new Date(),
	};
}

export function createLegacyPiOperationContext(
	args: PiOperationContextFactoryArgs,
	overrides: Partial<LegacyContextDependencies> = {},
): OperationContext {
	const dependencies = { ...defaultDependencies(), ...overrides };
	const now = dependencies.now();
	return {
		signal: args.signal,
		requestId: createLegacyRequestId(now),
		session: null,
		captureAllowed: dependencies.captureAllowed(),
		backend: createLegacyBackendClient(dependencies),
		artifacts: dependencies.artifactWriter,
		reportProgress: args.reportProgress,
		now: dependencies.now,
	};
}
