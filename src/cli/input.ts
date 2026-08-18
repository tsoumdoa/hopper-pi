import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { TextDecoder } from "node:util";
import { ERROR_CODE } from "../core/contracts.js";

export const MAX_INPUT_BYTES = 1024 * 1024;

export class CliInputError extends Error {
	constructor(public readonly code: string, message: string) {
		super(message);
		this.name = "CliInputError";
	}
}

export type InputOptions = { input?: string; data?: string };

export async function loadJsonObject(
	options: InputOptions,
	stdin: NodeJS.ReadableStream = process.stdin,
): Promise<Record<string, unknown>> {
	const sources = Number(options.input !== undefined) + Number(options.data !== undefined);
	if (sources === 0) {
		throw new CliInputError(ERROR_CODE.INPUT_SOURCE_REQUIRED, "Use exactly one input source: --input path.json, --input -, or --data '{...}'");
	}
	if (sources > 1) {
		throw new CliInputError(ERROR_CODE.MULTIPLE_INPUT_SOURCES, "Use only one of --input or --data");
	}

	let bytes: Uint8Array;
	if (options.data !== undefined) {
		bytes = Buffer.from(options.data, "utf8");
		if (bytes.byteLength > MAX_INPUT_BYTES) throw tooLarge();
	} else if (options.input === "-") {
		bytes = await readBounded(stdin);
	} else {
		try {
			const file = options.input!;
			const metadata = await stat(file);
			if (!metadata.isFile()) throw new Error("not a regular file");
			bytes = await readBounded(createReadStream(file));
		} catch (error) {
			if (error instanceof CliInputError) throw error;
			throw new CliInputError(ERROR_CODE.INPUT_READ_FAILED, `Could not read input file: ${options.input}`);
		}
	}

	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw new CliInputError(ERROR_CODE.INVALID_UTF8, "Input must be valid UTF-8");
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new CliInputError(ERROR_CODE.INVALID_JSON, "Input must contain exactly one valid JSON value");
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new CliInputError(ERROR_CODE.INPUT_OBJECT_REQUIRED, "Input JSON root must be an object");
	}
	return parsed as Record<string, unknown>;
}

async function readBounded(stream: NodeJS.ReadableStream): Promise<Uint8Array> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of stream) {
		const buffer = Buffer.isBuffer(chunk)
			? chunk
			: typeof chunk === "string"
				? Buffer.from(chunk, "utf8")
				: Buffer.from(chunk as Uint8Array);
		size += buffer.byteLength;
		if (size > MAX_INPUT_BYTES) {
			if ("destroy" in stream && typeof stream.destroy === "function") stream.destroy();
			throw tooLarge();
		}
		chunks.push(buffer);
	}
	return Buffer.concat(chunks, size);
}

function tooLarge(): CliInputError {
	return new CliInputError(ERROR_CODE.INPUT_TOO_LARGE, "Input exceeds the 1 MiB limit");
}
