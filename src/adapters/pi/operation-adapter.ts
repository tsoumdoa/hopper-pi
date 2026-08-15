import { readFile } from "node:fs/promises";
import type {
	AgentToolResult,
	AgentToolUpdateCallback,
	ExtensionContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type {
	JsonValue,
	OperationResult,
	ProgressEvent,
} from "../../core/contracts.js";
import type {
	HopperOperation,
	OperationContext,
} from "../../core/operations.js";
import { OperationRegistry } from "../../core/operations.js";

export type PiOperationDetails<T extends JsonValue = JsonValue> =
	| { kind: "progress"; progress: ProgressEvent }
	| { kind: "result"; result: OperationResult<T> };

export type PiOperationContextFactoryArgs = {
	toolCallId: string;
	signal: AbortSignal;
	piContext: ExtensionContext;
	reportProgress(event: ProgressEvent): void;
};

export type PiOperationAdapterOptions = {
	label?: string;
	executionMode?: "parallel" | "sequential";
	createContext(
		args: PiOperationContextFactoryArgs,
	): OperationContext | Promise<OperationContext>;
};

export type PiOperationToolDefinition<T extends JsonValue = JsonValue> = Omit<
	ToolDefinition,
	"execute"
> & {
	execute(
		toolCallId: string,
		params: unknown,
		signal: AbortSignal | undefined,
		onUpdate: AgentToolUpdateCallback<PiOperationDetails<T>> | undefined,
		piContext: ExtensionContext,
	): Promise<AgentToolResult<PiOperationDetails<T>>>;
};

function formatProgress(event: ProgressEvent): string {
	if (event.completed === undefined || event.total === undefined) {
		return event.message;
	}
	return `${event.message} (${event.completed}/${event.total})`;
}

function stringifyData(data: JsonValue): string {
	return JSON.stringify(data, null, 2);
}

/** Render structured operation data for Pi's model-facing text channel. */
export function formatOperationResult(result: OperationResult<JsonValue>): string {
	const lines = [result.message, `Outcome: ${result.outcome}`];

	if (result.data !== null) {
		lines.push(`Data:\n${stringifyData(result.data)}`);
	}

	if (result.warnings.length > 0) {
		lines.push(
			`Warnings:\n${result.warnings
				.map((warning) => `- [${warning.code}] ${warning.message}`)
				.join("\n")}`,
		);
	}

	if (result.artifacts.length > 0) {
		lines.push(
			`Artifacts:\n${result.artifacts
				.map((artifact) => (
					`- ${artifact.kind}: ${artifact.path} `
					+ `(${artifact.mediaType}, ${artifact.byteLength} bytes, sha256 ${artifact.sha256})`
				))
				.join("\n")}`,
		);
	}

	if (result.error !== null) {
		lines.push(`Error [${result.error.code}]: ${result.error.message}`);
	}

	return lines.join("\n\n");
}

export function operationResultToAgentToolResult<T extends JsonValue>(
	result: OperationResult<T>,
): AgentToolResult<PiOperationDetails<T>> {
	return {
		content: [{ type: "text", text: formatOperationResult(result) }],
		details: { kind: "result", result },
	};
}

const MAX_PI_IMAGE_BYTES = 10 * 1024 * 1024;

async function operationResultToAgentToolResultWithArtifacts<T extends JsonValue>(
	result: OperationResult<T>,
): Promise<AgentToolResult<PiOperationDetails<T>>> {
	const converted = operationResultToAgentToolResult(result);
	for (const artifact of result.artifacts) {
		if (artifact.kind !== "viewport_capture" || !artifact.mediaType.startsWith("image/")) continue;
		if (artifact.byteLength <= 0 || artifact.byteLength > MAX_PI_IMAGE_BYTES) continue;
		try {
			const bytes = await readFile(artifact.path);
			if (bytes.byteLength !== artifact.byteLength) continue;
			converted.content.push({
				type: "image",
				data: bytes.toString("base64"),
				mimeType: artifact.mediaType,
			});
		} catch {
			// The structured result still reports the artifact and its path.
		}
	}
	return converted;
}

function defaultExecutionMode<I extends JsonValue, O extends JsonValue>(
	operation: HopperOperation<I, O>,
): "parallel" | "sequential" {
	return operation.possibleScopes.some((scope) => scope !== "none")
		? "sequential"
		: "parallel";
}

/**
 * Wrap a framework-neutral Hopper operation for the temporary Pi runtime.
 * Request IDs, sessions, backend access, and artifact storage stay with the
 * caller-supplied context factory rather than being guessed from a Pi tool call.
 */
export function createPiToolDefinition<I extends JsonValue, O extends JsonValue>(
	operation: HopperOperation<I, O>,
	options: PiOperationAdapterOptions,
): PiOperationToolDefinition<O> {
	const registry = new OperationRegistry();
	registry.register(operation);

	return {
		name: operation.name,
		label: options.label ?? operation.name,
		description: operation.description,
		parameters: operation.inputSchema as unknown as ToolDefinition["parameters"],
		executionMode: options.executionMode ?? defaultExecutionMode(operation),
		async execute(toolCallId, params, signal, onUpdate, piContext) {
			const executionSignal = signal ?? new AbortController().signal;
			const call = registry.resolve(operation.name, params);
			const reportProgress = (event: ProgressEvent): void => {
				onUpdate?.({
					content: [{ type: "text", text: formatProgress(event) }],
					details: { kind: "progress", progress: event },
				});
			};
			const context = await options.createContext({
				toolCallId,
				signal: executionSignal,
				piContext,
				reportProgress,
			});
			const result = await registry.execute(call, context);
			return operationResultToAgentToolResultWithArtifacts(result as OperationResult<O>);
		},
	};
}
