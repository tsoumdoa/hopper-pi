import type { EditId, JsonObject, SessionId } from "../core/contracts.js";

export type ParsedCommand =
	| { kind: "status"; json: boolean }
	| { kind: "catalog"; json: boolean }
	| { kind: "schema"; operation: string; json: boolean }
	| {
		kind: "call";
		operation: string;
		sessionId?: SessionId;
		input: InputSource;
		allowCapture: boolean;
		json: boolean;
	}
	| SessionCommand
	| HistoryCommand
	| { kind: "help"; json: boolean }
	| { kind: "version"; json: boolean }
	| { kind: "parse-error"; message: string; json: boolean };

export type SessionCommand =
	| { kind: "session.start"; name?: string; captureAllowed: boolean; json: boolean }
	| { kind: "session.show"; sessionId: SessionId; json: boolean }
	| { kind: "session.list"; json: boolean }
	| { kind: "session.close"; sessionId: SessionId; json: boolean }
	| { kind: "session.rebind"; sessionId: SessionId; json: boolean };

export type HistoryCommand =
	| { kind: "history.list"; sessionId: SessionId; json: boolean }
	| { kind: "history.show"; sessionId: SessionId; editId: EditId; json: boolean }
	| { kind: "history.reconcile"; sessionId: SessionId; editId: EditId; json: boolean };

export type InputSource =
	| { kind: "file"; path: string }
	| { kind: "stdin" }
	| { kind: "inline"; json: string };

export class ArgParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ArgParseError";
	}
}

const SESSION_PATTERN = /^hs_[A-Za-z0-9_-]+$/;
const EDIT_PATTERN = /^edit_[A-Za-z0-9_-]+$/;

export function isSessionId(value: string): value is SessionId {
	return SESSION_PATTERN.test(value);
}

export function isEditId(value: string): value is EditId {
	return EDIT_PATTERN.test(value);
}

const HELP = `usage: hopper <command> [options]

commands:
  status                                   show backend connection and identity
  catalog                                  list available operations
  schema <operation>                       show an operation's JSON schemas
  call <operation> [--session hs_...]      execute an operation
      (--input path.json | --input - | --data '{...}')
      [--allow-capture]
  session start [--name "label"]           bind a new session to the live documents
      [--allow-capture]
  session show|close|rebind hs_...         inspect, close, or rebind a session
  session list                             list stored sessions
  history list hs_...                      list journal edits for a session
  history show hs_... edit_000001          show one materialized edit
  history reconcile hs_... edit_000001     resolve an unknown outcome
  help                                     show this help
  version                                  print the CLI version

global options:
  --json     emit one machine-readable JSON response document on stdout

environment:
  HOPPER_SESSION_ID      default session for call
  GH_ZMQ_REQ / GH_ZMQ_PUB / GH_ZMQ_PUSH / GH_ZMQ_TOKEN
                         backend connection overrides
`;

export function helpText(): string {
	return HELP;
}

export function parseArgs(argv: readonly string[], env: NodeJS.ProcessEnv): ParsedCommand {
	const args = [...argv];
	const json = consumeFlag(args, "--json");
	if (args.length === 0) {
		return { kind: "help", json };
	}
	const command = args.shift()!;
	switch (command) {
		case "help":
		case "--help":
		case "-h":
			return { kind: "help", json };
		case "version":
		case "--version":
			return { kind: "version", json };
		case "status":
			requireNoPositional(args, "status");
			return { kind: "status", json };
		case "catalog":
			requireNoPositional(args, "catalog");
			return { kind: "catalog", json };
		case "schema": {
			const operation = args.shift();
			if (!operation) {
				throw new ArgParseError("schema requires an operation name.");
			}
			requireNoPositional(args, "schema");
			return { kind: "schema", operation, json };
		}
		case "call":
			return parseCall(args, env, json);
		case "session": {
			const sub = args.shift();
			switch (sub) {
				case "start":
					return parseSessionStart(args, json);
				case "show":
				case "close":
				case "rebind":
					return parseSessionWithId(sub, args, json);
				case "list":
					requireNoPositional(args, "session list");
					return { kind: "session.list", json };
				default:
					throw new ArgParseError("Unknown session subcommand. Use start, show, list, close, or rebind.");
			}
		}
		case "history": {
			const sub = args.shift();
			const command = args.shift();
			if (!command || !command.startsWith("hs_")) {
				throw new ArgParseError("history requires a session ID: hopper history <subcommand> hs_... [edit_...]");
			}
			if (!isSessionId(command)) {
				throw new ArgParseError("history requires a valid hs_... session ID.");
			}
			const sessionId = command;
			switch (sub) {
				case "list":
					requireNoPositional(args, "history list");
					return { kind: "history.list", sessionId, json };
				case "show":
				case "reconcile": {
					const editId = args.shift();
					if (!editId || !isEditId(editId)) {
						throw new ArgParseError(`history ${sub} requires an edit_... ID.`);
					}
					return sub === "show"
						? { kind: "history.show", sessionId, editId, json }
						: { kind: "history.reconcile", sessionId, editId, json };
				}
				default:
					throw new ArgParseError("Unknown history subcommand. Use list, show, or reconcile.");
			}
		}
		default:
			throw new ArgParseError(`Unknown command '${command}'. Run 'hopper help'.`);
	}
}

function parseCall(args: string[], env: NodeJS.ProcessEnv, json: boolean): ParsedCommand {
	const operation = args.shift();
	if (!operation || operation.startsWith("--")) {
		throw new ArgParseError("call requires an operation name.");
	}

	let sessionId: SessionId | undefined;
	let input: InputSource | undefined;
	let inlineData: string | undefined;
	let allowCapture = false;

	while (args.length > 0) {
		const arg = args.shift()!;
		if (arg === "--session") {
			const value = args.shift();
			if (!value || !isSessionId(value)) {
				throw new ArgParseError("--session expects a hs_... session ID.");
			}
			sessionId = value;
		} else if (arg === "--input") {
			const value = args.shift();
			if (value === undefined) {
				throw new ArgParseError("--input expects a path or '-'.");
			}
			if (input) throw new ArgParseError("Provide exactly one of --input or --data.");
			input = value === "-" ? { kind: "stdin" } : { kind: "file", path: value };
		} else if (arg === "--data") {
			const value = args.shift();
			if (value === undefined) {
				throw new ArgParseError("--data expects a JSON string.");
			}
			if (input) throw new ArgParseError("Provide exactly one of --input or --data.");
			input = { kind: "inline", json: value };
			inlineData = value;
		} else if (arg === "--allow-capture") {
			allowCapture = true;
		} else {
			throw new ArgParseError(`Unknown option '${arg}' for call.`);
		}
	}

	if (!input) {
		if (env.HOPPER_SESSION_ID && !isSessionId(env.HOPPER_SESSION_ID)) {
			throw new ArgParseError("HOPPER_SESSION_ID is not a valid hs_... session ID.");
		}
		throw new ArgParseError(
			"call requires exactly one input source: --input path.json, --input -, or --data '{...}'.",
		);
	}

	const envSession = env.HOPPER_SESSION_ID;
	if (envSession && !isSessionId(envSession)) {
		throw new ArgParseError("HOPPER_SESSION_ID is not a valid hs_... session ID.");
	}
	const resolvedSession = sessionId ?? (envSession as SessionId | undefined);

	return {
		kind: "call",
		operation,
		sessionId: resolvedSession,
		input,
		allowCapture,
		json,
	};
}

function parseSessionStart(args: string[], json: boolean): ParsedCommand {
	let name: string | undefined;
	let captureAllowed = false;
	while (args.length > 0) {
		const arg = args.shift()!;
		if (arg === "--name") {
			const value = args.shift();
			if (value === undefined) throw new ArgParseError("--name expects a value.");
			name = value;
		} else if (arg === "--allow-capture") {
			captureAllowed = true;
		} else {
			throw new ArgParseError(`Unknown option '${arg}' for session start.`);
		}
	}
	return { kind: "session.start", name, captureAllowed, json };
}

function parseSessionWithId(sub: string, args: string[], json: boolean): ParsedCommand {
	const sessionId = args.shift();
	if (!sessionId || !isSessionId(sessionId)) {
		throw new ArgParseError(`session ${sub} requires a valid hs_... session ID.`);
	}
	requireNoPositional(args, `session ${sub}`);
	switch (sub) {
		case "show":
			return { kind: "session.show", sessionId, json };
		case "close":
			return { kind: "session.close", sessionId, json };
		default:
			return { kind: "session.rebind", sessionId, json };
	}
}

function consumeFlag(args: string[], flag: string): boolean {
	const index = args.indexOf(flag);
	if (index === -1) return false;
	args.splice(index, 1);
	return true;
}

function requireNoPositional(args: readonly string[], command: string): void {
	if (args.length > 0) {
		throw new ArgParseError(`'${command}' takes no arguments.`);
	}
}

export function summarizeParseIssues(input: JsonObject): JsonObject {
	return input;
}
