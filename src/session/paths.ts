import { existsSync } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import type {
	BackendId,
	EditId,
	GrasshopperDocumentId,
	RequestId,
	RhinoDocumentId,
	SessionId,
} from "../core/contracts.js";

const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function resolveStateRoot(env: NodeJS.ProcessEnv = process.env): string {
	const override = env.HOPPER_STATE_DIR;
	if (override && override.trim().length > 0) {
		return join(override.trim(), "hopper");
	}
	const home = env.HOME ?? "";
	const platform = process.platform;
	if (platform === "darwin") {
		return join(home, "Library", "Application Support", "hoppercode");
	}
	if (platform === "win32") {
		const appData = env.APPDATA ?? join(home, "AppData", "Roaming");
		return join(appData, "hoppercode");
	}
	const xdg = env.XDG_STATE_HOME ?? join(home, ".local", "state");
	return join(xdg, "hoppercode");
}

export function sessionDirectory(stateRoot: string, sessionId: SessionId): string {
	return join(stateRoot, "sessions", sessionId);
}

export function sessionFilePath(stateRoot: string, sessionId: SessionId): string {
	return join(sessionDirectory(stateRoot, sessionId), "session.json");
}

export function journalPath(stateRoot: string, sessionId: SessionId): string {
	return join(sessionDirectory(stateRoot, sessionId), "events.jsonl");
}

export function requestsDirectory(stateRoot: string, sessionId: SessionId): string {
	return join(sessionDirectory(stateRoot, sessionId), "requests");
}

export function checkpointsDirectory(stateRoot: string, sessionId: SessionId): string {
	return join(sessionDirectory(stateRoot, sessionId), "checkpoints");
}

export function artifactsDirectory(stateRoot: string, sessionId: SessionId): string {
	return join(sessionDirectory(stateRoot, sessionId), "artifacts");
}

export function lockPath(stateRoot: string, sessionId: SessionId): string {
	return join(sessionDirectory(stateRoot, sessionId), ".write-lock", "owner.json");
}

export async function ensureSessionLayout(stateRoot: string, sessionId: SessionId): Promise<string> {
	const directory = sessionDirectory(stateRoot, sessionId);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	await mkdir(requestsDirectory(stateRoot, sessionId), { recursive: true, mode: 0o700 });
	await mkdir(checkpointsDirectory(stateRoot, sessionId), { recursive: true, mode: 0o700 });
	await mkdir(artifactsDirectory(stateRoot, sessionId), { recursive: true, mode: 0o700 });
	return directory;
}

/**
 * Atomic durable write: write to a sibling temporary file, flush, rename, then
 * flush the directory when the platform supports it.
 */
export async function writeFileAtomic(
	path: string,
	contents: string,
	options: { mode?: number } = {},
): Promise<void> {
	const temporary = join(dirname(path), `.tmp-${randomBytes(6).toString("hex")}`);
	const handle = await open(temporary, "w", options.mode ?? 0o600);
	try {
		await handle.writeFile(contents, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
	const { rename } = await import("node:fs/promises");
	await rename(temporary, path);
	await flushDirectory(dirname(path));
}

export async function flushDirectory(directory: string): Promise<void> {
	if (process.platform === "win32") return;
	let handle;
	try {
		handle = await open(directory, "r");
		await handle.sync();
	} catch {
		// Directory sync is best effort on exotic filesystems.
	} finally {
		await handle?.close().catch(() => {});
	}
}

export async function appendLineDurable(path: string, line: string): Promise<void> {
	const handle = await open(path, "a", 0o600);
	try {
		await handle.writeFile(`${line}\n`, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
}

export function newEventId(): string {
	return `evt_${randomBytes(10).toString("hex")}`;
}

export function newSessionId(now: Date = new Date()): SessionId {
	const timestamp = encodeBase32(BigInt(now.getTime()), 10);
	return `hs_${timestamp}${randomBase32(16)}`;
}

export function newBackendId(): BackendId {
	return `be_${randomBase32(20)}`;
}

export function editIdFromSequence(sequence: number): EditId {
	if (!Number.isSafeInteger(sequence) || sequence <= 0 || sequence > 0xffffff) {
		throw new RangeError(`Edit sequence out of range: ${sequence}`);
	}
	return `edit_${sequence.toString(10).padStart(6, "0")}` as EditId;
}

export function sequenceFromEditId(editId: EditId): number {
	const match = /^edit_(\d{6})$/.exec(editId);
	if (!match) throw new RangeError(`Malformed edit ID: ${editId}`);
	return Number.parseInt(match[1]!, 10);
}

export function newRequestIdLike(now: Date = new Date()): RequestId {
	return `req_${encodeBase32(BigInt(now.getTime()), 10)}${randomBase32(16)}`;
}

export type StoredIdentityBinding = {
	backendId: BackendId;
	grasshopperDocumentId: GrasshopperDocumentId;
	rhinoDocumentId: RhinoDocumentId | null;
};

export function randomBase32(length: number): string {
	const bytes = randomBytes(length);
	let encoded = "";
	for (let index = 0; index < length; index++) {
		encoded += CROCKFORD_BASE32[bytes[index]! & 31];
	}
	return encoded;
}

export function encodeBase32(value: bigint, length: number): string {
	let encoded = "";
	for (let index = 0; index < length; index++) {
		encoded = CROCKFORD_BASE32[Number(value & 31n)] + encoded;
		value >>= 5n;
	}
	return encoded;
}

export function pathExists(path: string): boolean {
	return existsSync(path);
}
