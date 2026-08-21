#!/usr/bin/env node

import { Command, CommanderError } from "commander";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Value } from "@sinclair/typebox/value";
import type { PrototypeOperation, CliResponse } from "../core/contracts.js";
import {
	CLI_EXIT,
	ERROR_CODE,
	cliFailure,
	cliSuccess,
} from "../core/contracts.js";
import { PingBackendResponseSchema } from "../core/backend-schemas.js";
import {
	createPrototypeOperations,
	defaultBackendRequest,
	findOperation,
	type BackendRequest,
} from "../core/operations.js";
import { validateSchema, validationMessage } from "../core/validation.js";
import type { DocumentTarget } from "../core/contracts.js";
import { CliInputError, loadJsonObject, type InputOptions } from "./input.js";
import packageJson from "../../package.json" with { type: "json" };

type CliDependencies = {
	operations?: PrototypeOperation[];
	request?: BackendRequest;
	stdin?: NodeJS.ReadableStream;
	stdout?: Pick<NodeJS.WriteStream, "write">;
	stderr?: Pick<NodeJS.WriteStream, "write">;
};

type Invocation =
	| { kind: "status" }
	| { kind: "operations"; namespace: "gh" | "rh" }
	| { kind: "schema"; namespace: "gh" | "rh"; publicName: string }
	| { kind: "call"; namespace: "gh" | "rh"; publicName: string; input: InputOptions };

export async function runCli(argv = process.argv, dependencies: CliDependencies = {}): Promise<number> {
	const stdout = dependencies.stdout ?? process.stdout;
	const stderr = dependencies.stderr ?? process.stderr;
	const request = dependencies.request ?? defaultBackendRequest;
	const operations = dependencies.operations ?? createPrototypeOperations(request);
	let invocation: Invocation | undefined;
	let jsonRequested = argv.includes("--json");
	let helpOrVersion = argv.includes("--help") || argv.includes("-h") || argv.includes("--version") || argv.includes("-V");
	const duplicateInputFlag = countFlag(argv, "--input") > 1 || countFlag(argv, "--data") > 1;

	const program = new Command();
	program
		.name("hopper")
		.description("JSON CLI for the Hopper Grasshopper and Rhino backend")
		.version(packageJson.version)
		.exitOverride()
		.configureOutput({
			writeOut: (text) => stdout.write(text),
			writeErr: () => undefined,
		});

	program.command("status")
		.requiredOption("--json", "emit JSON")
		.action(() => { invocation = { kind: "status" }; });

	for (const namespace of ["gh", "rh"] as const) {
		const group = program.command(namespace);
		group.command("operations")
			.requiredOption("--json", "emit JSON")
			.action(() => { invocation = { kind: "operations", namespace }; });
		group.command("schema")
			.argument("<operation>")
			.requiredOption("--json", "emit JSON")
			.action((publicName: string) => { invocation = { kind: "schema", namespace, publicName }; });
		group.command("call")
			.argument("<operation>")
			.option("--input <path>")
			.option("--data <json>")
			.requiredOption("--json", "emit JSON")
			.action((publicName: string, options: InputOptions) => {
				invocation = { kind: "call", namespace, publicName, input: { input: options.input, data: options.data } };
			});
	}

	try {
		await program.parseAsync(argv);
	} catch (error) {
		if (helpOrVersion && error instanceof CommanderError && ["commander.helpDisplayed", "commander.version"].includes(error.code)) return CLI_EXIT.SUCCESS;
		const response = cliFailure(commandHint(argv), ERROR_CODE.INVALID_COMMAND, cleanCommanderMessage(error));
		writeJson(stdout, response);
		return CLI_EXIT.INVALID_INPUT;
	}

	if (helpOrVersion) return CLI_EXIT.SUCCESS;
	if (!jsonRequested || !invocation) {
		writeJson(stdout, cliFailure(commandHint(argv), ERROR_CODE.JSON_REQUIRED, "--json is required"));
		return CLI_EXIT.INVALID_INPUT;
	}
	if (invocation.kind === "call" && duplicateInputFlag) {
		writeJson(stdout, cliFailure(commandName(invocation), ERROR_CODE.MULTIPLE_INPUT_SOURCES, "Input flags may not be repeated"));
		return CLI_EXIT.INVALID_INPUT;
	}

	const abort = new AbortController();
	const interrupt = () => abort.abort();
	process.once("SIGINT", interrupt);
	process.once("SIGTERM", interrupt);

	try {
		const handled = await executeInvocation(invocation, operations, request, abort.signal, dependencies.stdin);
		writeJson(stdout, handled.response);
		return handled.exitCode;
	} catch {
		writeJson(stdout, cliFailure(commandName(invocation), ERROR_CODE.INTERNAL_ERROR, "Internal CLI error"));
		return CLI_EXIT.INTERNAL_ERROR;
	} finally {
		process.removeListener("SIGINT", interrupt);
		process.removeListener("SIGTERM", interrupt);
	}
}

async function executeInvocation(
	invocation: Invocation,
	operations: PrototypeOperation[],
	request: BackendRequest,
	signal: AbortSignal,
	stdin?: NodeJS.ReadableStream,
): Promise<{ response: CliResponse; exitCode: number }> {
	const command = commandName(invocation);
	if (invocation.kind === "operations") {
		const data = operations
			.filter((operation) => operation.namespace === invocation.namespace)
			.map(({ publicName: name, name: internalName, description, mutates }) => ({ name, internalName, description, mutates }));
		return { response: cliSuccess(command, `${data.length} operation(s) available`, data), exitCode: CLI_EXIT.SUCCESS };
	}

	if (invocation.kind === "schema") {
		const operation = findOperation(invocation.namespace, invocation.publicName, operations);
		if (!operation) return unknownOperation(command, invocation.publicName);
		return {
			response: cliSuccess(command, `Schema for ${operation.name}`, {
				$schema: "https://json-schema.org/draft/2020-12/schema",
				input: operation.inputSchema,
				output: operation.outputSchema,
			}, null, operation.name),
			exitCode: CLI_EXIT.SUCCESS,
		};
	}

	if (invocation.kind === "status") {
		let raw: unknown;
		try {
			raw = await request({ type: "ping" }, { signal, mutates: false, timeoutMs: 8_000 });
		} catch {
			const response = cliFailure(command, ERROR_CODE.BACKEND_UNAVAILABLE, "Hopper backend is unavailable", { retryable: true });
			return { response, exitCode: CLI_EXIT.BACKEND_UNAVAILABLE };
		}
		if (raw && typeof raw === "object" && (raw as { type?: string }).type === "auth.error") {
			return { response: cliFailure(command, ERROR_CODE.AUTHENTICATION_FAILED, "Backend authentication failed"), exitCode: CLI_EXIT.BACKEND_UNAVAILABLE };
		}
		if (!Value.Check(PingBackendResponseSchema, raw)) {
			return { response: cliFailure(command, ERROR_CODE.MALFORMED_BACKEND_RESPONSE, "Backend returned an invalid ping response"), exitCode: CLI_EXIT.BACKEND_UNAVAILABLE };
		}
		return {
			response: cliSuccess(command, "Hopper backend is available", {
				backendInstanceId: raw.target.backendInstanceId,
				backendStartedAt: raw.backendStartedAt,
			}, raw.target as DocumentTarget),
			exitCode: CLI_EXIT.SUCCESS,
		};
	}

	const operation = findOperation(invocation.namespace, invocation.publicName, operations);
	if (!operation) return unknownOperation(command, invocation.publicName);
	let input: Record<string, unknown>;
	try {
		input = await loadJsonObject(invocation.input, stdin, signal);
	} catch (error) {
		const code = error instanceof CliInputError ? error.code : ERROR_CODE.INPUT_READ_FAILED;
		const message = error instanceof Error ? error.message : "Could not read input";
		return {
			response: cliFailure(command, code, message, { operation: operation.name }),
			exitCode: code === ERROR_CODE.INTERRUPTED ? CLI_EXIT.OPERATION_FAILED : CLI_EXIT.INVALID_INPUT,
		};
	}
	const validation = validateSchema(operation.inputSchema, input);
	if (!validation.ok) {
		return {
			response: cliFailure(command, ERROR_CODE.INPUT_SCHEMA_INVALID, validationMessage(validation), { operation: operation.name }),
			exitCode: CLI_EXIT.INVALID_INPUT,
		};
	}
	const result = await operation.execute(input, signal);
	if (result.outcome === "succeeded") {
		const outputValidation = validateSchema(operation.outputSchema, result.data);
		if (!outputValidation.ok) {
			const response = cliFailure(command, ERROR_CODE.MALFORMED_BACKEND_RESPONSE, "Operation produced invalid output", {
				operation: operation.name,
				outcome: operation.mutates ? "unknown" : "failed",
				target: result.target,
			});
			return { response, exitCode: operation.mutates ? CLI_EXIT.MUTATION_UNKNOWN : CLI_EXIT.OPERATION_FAILED };
		}
		return {
			response: { schemaVersion: 1, ok: true, command, operation: operation.name, ...result },
			exitCode: CLI_EXIT.SUCCESS,
		};
	}
	return {
		response: { schemaVersion: 1, ok: false, command, operation: operation.name, ...result },
		exitCode: result.outcome === "unknown"
			? CLI_EXIT.MUTATION_UNKNOWN
			: result.error.code === ERROR_CODE.AUTHENTICATION_FAILED || result.error.code === ERROR_CODE.BACKEND_UNAVAILABLE
				? CLI_EXIT.BACKEND_UNAVAILABLE
				: result.error.code === ERROR_CODE.INPUT_SCHEMA_INVALID
					? CLI_EXIT.INVALID_INPUT
					: CLI_EXIT.OPERATION_FAILED,
	};
}

function unknownOperation(command: string, publicName: string): { response: CliResponse; exitCode: number } {
	return {
		response: cliFailure(command, ERROR_CODE.UNKNOWN_OPERATION, `Unknown operation: ${publicName}`),
		exitCode: CLI_EXIT.INVALID_INPUT,
	};
}

function commandName(invocation: Invocation): string {
	if (invocation.kind === "status") return "status";
	return `${invocation.namespace}.${invocation.kind}`;
}

function commandHint(argv: string[]): string {
	const args = argv.slice(2).filter((arg) => !arg.startsWith("-"));
	if (args[0] === "status") return "status";
	if ((args[0] === "gh" || args[0] === "rh") && args[1]) return `${args[0]}.${args[1]}`;
	return "unknown";
}

function countFlag(argv: string[], flag: string): number {
	return argv.slice(2).filter((arg) => arg === flag || arg.startsWith(`${flag}=`)).length;
}

function cleanCommanderMessage(error: unknown): string {
	if (!(error instanceof Error)) return "Invalid command";
	return error.message.replace(/^error:\s*/i, "").replace(/\s*\n.*/s, "").trim() || "Invalid command";
}

function writeJson(stdout: Pick<NodeJS.WriteStream, "write">, response: CliResponse): void {
	try {
		stdout.write(`${JSON.stringify(response, (_key, value) =>
			typeof value === "string" ? stripAnsi(value) : value)}\n`);
	} catch (error) {
		if (!isBrokenPipe(error)) throw error;
	}
}

function stripAnsi(value: string): string {
	return value
		.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
		.replace(/\u009b[0-?]*[ -/]*[@-~]/g, "")
		.replace(/[\u001b\u009b]/g, "");
}

function isBrokenPipe(error: unknown): boolean {
	return !!error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "EPIPE";
}

if (isDirectExecution()) {
	process.stdout.on("error", (error: NodeJS.ErrnoException) => {
		if (error.code === "EPIPE") process.exit(0);
		throw error;
	});
	runCli().then((code) => {
		process.exitCode = code;
	}).catch(() => {
		process.exitCode = CLI_EXIT.INTERNAL_ERROR;
	});
}

function isDirectExecution(): boolean {
	if (!process.argv[1]) return false;
	try {
		return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
	} catch {
		return false;
	}
}
