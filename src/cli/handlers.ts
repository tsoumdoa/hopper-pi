import { createOperationRegistry } from "../operations/index.js";
import type { JsonObject, JsonValue, OperationOutcome } from "../core/contracts.js";
import { HopperCoreError, type HopperError } from "../core/errors.js";
import { OperationRegistry } from "../core/operations.js";
import { createBackendClient, type BackendClient } from "../protocol/backend-client.js";
import { resolveConnection } from "../infra/connection.js";
import { createArtifactWriter } from "../infra/artifact-writer.js";
import type { CliIO } from "./io.js";
import { loadJsonInput } from "./input.js";
import { cliError, cliResponse, type CliResponse } from "./response.js";
import type { ParsedCommand } from "./args.js";
import { createV1OperationContext } from "./backend.js";
import type { ConnectionConfig } from "../infra/connection.js";

const CLI_VERSION = "0.1.90";

export type CliDependencies = {
	registry: OperationRegistry;
	connection: () => ConnectionConfig;
	createProtocolClient?: (connection: ConnectionConfig) => BackendClient;
	artifactsRoot?: string;
	io: CliIO;
	now(): Date;
};

export function defaultDependencies(io: CliIO): CliDependencies {
	return {
		registry: createOperationRegistry(),
		connection: () => resolveConnection(),
		io,
		now: () => new Date(),
	};
}

function protocolClient(deps: CliDependencies): BackendClient {
	return (deps.createProtocolClient ?? ((connection: ConnectionConfig) => createBackendClient(connection)))(deps.connection());
}

export async function handleStatus(
	command: Extract<ParsedCommand, { kind: "status" }>,
	deps: CliDependencies,
): Promise<CliResponse> {
	const client = protocolClient(deps);
	try {
		const info = await client.getInfo();
		return cliResponse({
			ok: true,
			command: "status",
			outcome: "succeeded",
			message: "Backend online.",
			data: {
				cliVersion: CLI_VERSION,
				backend: info.backend,
				documents: info.documents,
				capabilities: info.data?.capabilities ?? [],
			} as JsonObject,
			artifacts: [],
			warnings: [],
			error: null,
		});
	} catch (error) {
		return statusFailure(error);
	} finally {
		await client.close().catch(() => {});
	}
}

function statusFailure(error: unknown): CliResponse {
	const hopper = toHopperError(error);
	return cliError("status", hopper, { message: `Backend offline or unreachable: ${hopper.message}` });
}

export function handleCatalog(
	command: Extract<ParsedCommand, { kind: "catalog" }>,
	deps: CliDependencies,
): CliResponse {
	return cliResponse({
		ok: true,
		command: "catalog",
		outcome: "succeeded",
		message: `${deps.registry.list().length} operations available.`,
		data: { operations: deps.registry.list() as unknown as JsonValue },
		artifacts: [],
		warnings: [],
		error: null,
	});
}

export function handleSchema(
	command: Extract<ParsedCommand, { kind: "schema" }>,
	deps: CliDependencies,
): CliResponse {
	const schema = deps.registry.schema(command.operation);
	if (!schema) {
		return cliError("schema", {
			code: "operation_not_found",
			message: `Unknown operation '${command.operation}'. Run 'hopper catalog'.`,
			retryable: false,
		});
	}
	return cliResponse({
		ok: true,
		command: "schema",
		operation: command.operation,
		outcome: "succeeded",
		message: `Schema for ${command.operation}.`,
		data: schema as unknown as JsonValue,
		artifacts: [],
		warnings: [],
		error: null,
	});
}

export async function handleCall(
	command: Extract<ParsedCommand, { kind: "call" }>,
	deps: CliDependencies,
): Promise<CliResponse> {
	let input: JsonValue;
	try {
		input = await loadJsonInput(command.input, deps.io);
	} catch (error) {
		return cliError("call", {
			code: "invalid_input",
			message: error instanceof Error ? error.message : String(error),
			retryable: false,
		}, { operation: command.operation });
	}

	let call;
	try {
		call = deps.registry.resolve(command.operation, input);
	} catch (error) {
		if (error instanceof HopperCoreError) {
			return cliError("call", error.hopperError, { operation: command.operation });
		}
		throw error;
	}
	const connection = deps.connection();
	const { context, backend } = createV1OperationContext(
		{
			connection,
			artifacts: createArtifactWriter(deps.artifactsRoot),
			protocolClient: deps.createProtocolClient,
		},
		{
			signal: AbortSignal.timeout(300_000),
			captureAllowed: command.allowCapture,
			session: null,
			reportProgress: () => {},
		},
	);
	const requestId = context.requestId;
	try {
		const result = await deps.registry.execute(call, context);
		return cliResponse({
			ok: result.outcome === "succeeded" || result.outcome === "partial",
			command: "call",
			operation: command.operation,
			requestId,
			outcome: result.outcome,
			message: result.message,
			data: result.data,
			artifacts: result.artifacts,
			warnings: result.warnings,
			error: result.error,
		});
	} catch (error) {
		if (error instanceof HopperCoreError) {
			return cliError("call", error.hopperError, { operation: command.operation });
		}
		return cliError("call", {
			code: "internal_error",
			message: error instanceof Error ? error.message : String(error),
			retryable: false,
		}, { operation: command.operation });
	} finally {
		await backend.close().catch(() => {});
	}
}

function toHopperError(error: unknown): HopperError {
	if (error instanceof HopperCoreError) return error.hopperError;
	return {
		code: "backend_offline",
		message: error instanceof Error ? error.message : String(error),
		retryable: true,
	};
}

export { CLI_VERSION };
export type { OperationOutcome };
