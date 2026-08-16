import { randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CanonicalCanvas, SessionId } from "../core/contracts.js";
import { digestBytes, emptyCanvas } from "../core/canvas.js";
import { HopperCoreError } from "../core/errors.js";
import type { CanvasCheckpointEnvelope } from "../protocol/wire.js";
import {
	checkpointsDirectory,
	ensureSessionLayout,
	writeFileAtomic,
} from "./paths.js";

export type CheckpointRecord = {
	checkpointId: string;
	path: string;
	compressedByteLength: number;
	binarySha256: string;
	canvasDigest: string;
};

export type StoredCheckpoint = {
	schemaVersion: 1;
	record: CheckpointRecord;
	envelope: CanvasCheckpointEnvelope;
	canonicalCanvas: CanonicalCanvas;
};

const MAX_CHECKPOINT_BYTES = 64 * 1024 * 1024;

export function newCheckpointId(): string {
	return `cp_${randomBytes(10).toString("hex")}`;
}

function metadataPath(stateRoot: string, sessionId: SessionId, checkpointId: string): string {
	return join(checkpointsDirectory(stateRoot, sessionId), `${checkpointId}.json`);
}

function payloadPath(stateRoot: string, sessionId: SessionId, checkpointId: string): string {
	return join(checkpointsDirectory(stateRoot, sessionId), `${checkpointId}.bin.gz`);
}

export function decodeCheckpointBytes(envelope: CanvasCheckpointEnvelope): Buffer {
	if (envelope.encoding !== "base64" || envelope.compression !== "none") {
		throw new HopperCoreError({
			code: "invalid_input",
			message: "Checkpoint encoding must be uncompressed base64.",
			retryable: false,
		});
	}
	let bytes: Buffer;
	try {
		bytes = Buffer.from(envelope.bytes, "base64");
	} catch {
		throw new HopperCoreError({
			code: "invalid_input",
			message: "Checkpoint bytes are not valid base64.",
			retryable: false,
		});
	}
	if (bytes.byteLength !== envelope.byteLength) {
		throw new HopperCoreError({
			code: "invalid_input",
			message: "Checkpoint byteLength does not match the decoded payload.",
			retryable: false,
		});
	}
	if (bytes.byteLength === 0 || bytes.byteLength > MAX_CHECKPOINT_BYTES) {
		throw new HopperCoreError({
			code: "invalid_input",
			message: "Checkpoint payload is empty or exceeds the size limit.",
			retryable: false,
		});
	}
	const digest = digestBytes(bytes);
	if (digest !== envelope.binarySha256) {
		throw new HopperCoreError({
			code: "invalid_input",
			message: "Checkpoint binarySha256 does not match the payload bytes.",
			retryable: false,
		});
	}
	return bytes;
}

export function envelopeForRestore(stored: StoredCheckpoint): CanvasCheckpointEnvelope {
	const bytes = gunzipSync(Buffer.from(stored.envelope.bytes, "base64"));
	return {
		...stored.envelope,
		compression: "none",
		encoding: "base64",
		bytes: bytes.toString("base64"),
		byteLength: bytes.byteLength,
		binarySha256: digestBytes(bytes),
	};
}

export class CheckpointStore {
	constructor(readonly stateRoot: string) {}

	async save(
		sessionId: SessionId,
		checkpoint: CanvasCheckpointEnvelope,
	): Promise<CheckpointRecord> {
		const bytes = decodeCheckpointBytes(checkpoint);
		await ensureSessionLayout(this.stateRoot, sessionId);
		const compressed = gzipSync(bytes);
		const checkpointId = checkpoint.checkpointId || newCheckpointId();
		const record: CheckpointRecord = {
			checkpointId,
			path: payloadPath(this.stateRoot, sessionId, checkpointId),
			compressedByteLength: compressed.byteLength,
			binarySha256: checkpoint.binarySha256,
			canvasDigest: checkpoint.canvasDigest,
		};
		const stored: StoredCheckpoint = {
			schemaVersion: 1,
			record,
			envelope: {
				...checkpoint,
				checkpointId,
				compression: "gzip",
				bytes: compressed.toString("base64"),
				byteLength: compressed.byteLength,
			},
			canonicalCanvas: checkpoint.canonicalCanvas ?? emptyCanvas(),
		};
		await writeFile(record.path, compressed, { mode: 0o600 });
		await chmod(record.path, 0o600).catch(() => {});
		await writeFileAtomic(
			metadataPath(this.stateRoot, sessionId, checkpointId),
			`${JSON.stringify(stored)}\n`,
			{ mode: 0o600 },
		);
		return record;
	}

	async read(sessionId: SessionId, checkpointId: string): Promise<StoredCheckpoint> {
		try {
			const contents = await readFile(
				metadataPath(this.stateRoot, sessionId, checkpointId),
				"utf8",
			);
			return JSON.parse(contents) as StoredCheckpoint;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				throw new HopperCoreError({
					code: "request_not_found",
					message: `Checkpoint ${checkpointId} does not exist.`,
					retryable: false,
				});
			}
			throw new HopperCoreError({
				code: "internal_error",
				message: `Checkpoint ${checkpointId} could not be read.`,
				retryable: false,
			});
		}
	}

	async verify(sessionId: SessionId, checkpointId: string): Promise<void> {
		const stored = await this.read(sessionId, checkpointId);
		const compressed = await readFile(payloadPath(this.stateRoot, sessionId, checkpointId));
		const bytes = gunzipSync(compressed);
		const digest = digestBytes(bytes);
		if (digest !== stored.record.binarySha256) {
			throw new HopperCoreError({
				code: "invalid_input",
				message: "Stored checkpoint bytes are corrupt.",
				retryable: false,
			});
		}
	}
}
