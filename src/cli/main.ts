#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { helpText, parseArgs } from "./args.js";
import { processIO, writeErr, writeOut, isTTY } from "./io.js";
import {
	CLI_VERSION,
	defaultDependencies,
	handleCall,
	handleCatalog,
	handleSchema,
	handleStatus,
} from "./handlers.js";
import { handleHistory, handleSession } from "./session-handlers.js";
import { mapOutcomeToExitCode, type CliResponse } from "./response.js";

export async function writeCliResponse(response: CliResponse, json: boolean, io: ReturnType<typeof processIO>): Promise<void> {
	if (json) {
		await writeOut(io, `${JSON.stringify(response)}\n`);
		return;
	}
	if (!response.ok) {
		const detail = response.error ? ` (${response.error.code})` : "";
		await writeOut(io, `${response.message}${detail}\n`);
		if (response.artifacts.length > 0) {
			for (const artifact of response.artifacts) {
				await writeOut(io, `artifact: ${artifact.path}\n`);
			}
		}
		return;
	}
	await writeOut(io, `${JSON.stringify(response.data, null, 2)}\n`);
	if (response.artifacts.length > 0) {
		for (const artifact of response.artifacts) {
			await writeOut(io, `artifact: ${artifact.path}\n`);
		}
	}
}

export async function runCli(argv: readonly string[], io: ReturnType<typeof processIO>): Promise<number> {
	let parsed;
	try {
		parsed = parseArgs(argv, io.env);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (isTTY(io)) await writeErr(io, `${message}\n`);
		await writeOut(io, `${JSON.stringify({
			schemaVersion: 1,
			ok: false,
			command: "parse-error",
			outcome: "failed",
			message,
			data: null,
			artifacts: [],
			warnings: [],
			error: { code: "invalid_command", message, retryable: false },
		})}\n`);
		return 2;
	}

	const deps = defaultDependencies(io);
	switch (parsed.kind) {
		case "help":
			await writeOut(io, helpText());
			return 0;
		case "version":
			await writeOut(io, `${CLI_VERSION}\n`);
			return 0;
		case "status":
			return finish(await handleStatus(parsed, deps), parsed.json, io);
		case "catalog":
			return finish(handleCatalog(parsed, deps), parsed.json, io);
		case "schema":
			return finish(handleSchema(parsed, deps), parsed.json, io);
		case "call":
			return finish(await handleCall(parsed, deps), parsed.json, io);
		case "session.start":
		case "session.show":
		case "session.list":
		case "session.close":
		case "session.rebind":
			return finish(await handleSession(parsed, deps), parsed.json, io);
		case "history.list":
		case "history.show":
		case "history.reconcile":
			return finish(await handleHistory(parsed, deps), parsed.json, io);
		case "parse-error":
			await writeOut(io, `${JSON.stringify({
				schemaVersion: 1,
				ok: false,
				command: "parse-error",
				outcome: "failed",
				message: parsed.message,
				data: null,
				artifacts: [],
				warnings: [],
				error: { code: "invalid_command", message: parsed.message, retryable: false },
			})}\n`);
			return 2;
		default: {
			const message = "Unsupported command.";
			await writeOut(io, `${JSON.stringify({
				schemaVersion: 1,
				ok: false,
				command: "unknown",
				outcome: "failed",
				message,
				data: null,
				artifacts: [],
				warnings: [],
				error: { code: "invalid_command", message, retryable: false },
			})}\n`);
			return 2;
		}
	}
}

async function finish(response: CliResponse, json: boolean, io: ReturnType<typeof processIO>): Promise<number> {
	await writeCliResponse(response, json, io);
	return mapOutcomeToExitCode(response);
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
	const exitCode = await runCli(argv, processIO());
	if (exitCode !== 0) {
		process.exitCode = exitCode;
	}
}

const invokedAsScript = (() => {
	try {
		return realpathSync(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
	} catch {
		return false;
	}
})();

if (invokedAsScript) {
	await main();
}
