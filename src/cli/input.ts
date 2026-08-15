import { createInterface } from "node:readline";
import type { JsonObject, JsonValue } from "../core/contracts.js";
import type { CliIO } from "./io.js";
import type { InputSource } from "./args.js";

export const MAX_INPUT_BYTES = 32 * 1024 * 1024;

export async function loadJsonInput(
	source: InputSource,
	io: CliIO,
	maxBytes: number = MAX_INPUT_BYTES,
): Promise<JsonValue> {
	const text = await loadText(source, io, maxBytes);
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new Error(
			`Input is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("Input must be a JSON object.");
	}
	return parsed as JsonValue;
}

async function loadText(source: InputSource, io: CliIO, maxBytes: number): Promise<string> {
	if (source.kind === "inline") {
		return source.json;
	}
	if (source.kind === "stdin") {
		const chunks: Buffer[] = [];
		let total = 0;
		for await (const chunk of io.stdin) {
			const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
			total += buffer.byteLength;
			if (total > maxBytes) {
				throw new Error(`Input exceeds ${maxBytes} bytes.`);
			}
			chunks.push(buffer);
		}
		return Buffer.concat(chunks).toString("utf8");
	}
	const { readFile, stat } = await import("node:fs/promises");
	const info = await stat(source.path);
	if (!info.isFile()) {
		throw new Error(`Input path is not a file: ${source.path}`);
	}
	if (info.size > maxBytes) {
		throw new Error(`Input exceeds ${maxBytes} bytes.`);
	}
	const buffer = await readFile(source.path);
	return buffer.toString("utf8");
}

export function readStdin(io: CliIO, maxBytes: number): Promise<string> {
	return loadText({ kind: "stdin" }, io, maxBytes);
}

export { createInterface };
