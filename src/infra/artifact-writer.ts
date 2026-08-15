import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { ArtifactRecord, ArtifactWriter } from "../core/contracts.js";

export const DEFAULT_ARTIFACT_ROOT = join(tmpdir(), "hopper", "artifacts");

export const ARTIFACT_MEDIA_TYPES: Record<ArtifactRecord["kind"], readonly string[]> = {
	viewport_capture: ["image/png"],
	checkpoint: ["application/octet-stream"],
	diagnostic: ["text/plain", "application/json", "image/png"],
};

export const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;

function safeSuggestedName(suggestedName: string | undefined): string {
	const leaf = basename(suggestedName?.trim() || "artifact.bin");
	const sanitized = leaf.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^\.+/, "");
	return sanitized || "artifact.bin";
}

/**
 * Writes artifacts beneath a dedicated root with owner-only permissions and
 * never accepts a caller-provided filesystem path. Sessionless commands use a
 * temporary root; sessions pass their artifact directory.
 */
export function createArtifactWriter(rootDirectory: string = DEFAULT_ARTIFACT_ROOT): ArtifactWriter {
	return {
		async write(options): Promise<ArtifactRecord> {
			const allowed = ARTIFACT_MEDIA_TYPES[options.kind];
			if (!allowed.includes(options.mediaType)) {
				throw new Error(
					`Unsupported media type ${options.mediaType} for ${options.kind} artifacts.`,
				);
			}
			const bytes = Buffer.from(options.bytes);
			if (bytes.byteLength === 0) {
				throw new Error("Artifact bytes must not be empty.");
			}
			if (bytes.byteLength > MAX_ARTIFACT_BYTES) {
				throw new Error(`Artifact exceeds ${MAX_ARTIFACT_BYTES} bytes.`);
			}
			const sha256 = createHash("sha256").update(bytes).digest("hex");
			const artifactId = `artifact_${randomBytes(12).toString("hex")}`;
			const path = join(rootDirectory, `${artifactId}-${safeSuggestedName(options.suggestedName)}`);
			await mkdir(rootDirectory, { recursive: true, mode: 0o700 });
			await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
			return {
				artifactId,
				kind: options.kind,
				path,
				mediaType: options.mediaType,
				byteLength: bytes.byteLength,
				sha256,
			};
		},
	};
}
