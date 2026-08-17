import { readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { hostname } from "node:os";
import { randomBytes } from "node:crypto";
import type { SessionId } from "../core/contracts.js";
import { lockPath, newEventId, writeFileAtomic } from "./paths.js";

export type LockOwner = {
	nonce: string;
	pid: number;
	hostname: string;
	processStartedAt: string;
	acquiredAt: string;
};

export interface SessionLock {
	owner: LockOwner;
	release(): Promise<void>;
}

export type AcquireOptions = {
	timeoutMs?: number;
	staleAfterMs?: number;
	/** Injectable for tests. */
	now?: () => Date;
	isProcessAlive?: (pid: number) => boolean;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_STALE_AFTER_MS = 120_000;

export class SessionLockError extends Error {
	constructor(
		message: string,
		readonly code: "session_locked" | "stale_lock_unrecoverable",
	) {
		super(message);
		this.name = "SessionLockError";
	}
}

function processAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function currentProcessStartedAt(): string {
	return new Date(Math.floor(process.uptime() * -1000) + Date.now()).toISOString();
}

/**
 * Acquires the session write lock by atomically creating `.write-lock/owner.json`.
 * A stale lock is reclaimed only when it belongs to the same host, the recorded
 * process no longer exists, and its age exceeds the threshold — PID age alone is
 * never enough because of PID reuse. Cross-host locks always require human
 * cleanup.
 */
export async function acquireSessionLock(
	sessionId: SessionId,
	stateRoot: string,
	options: AcquireOptions = {},
): Promise<SessionLock> {
	const path = lockPath(stateRoot, sessionId);
	const now = options.now ?? (() => new Date());
	const isAlive = options.isProcessAlive ?? processAlive;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
	const deadline = Date.now() + timeoutMs;

	for (;;) {
		const owner: LockOwner = {
			nonce: randomBytes(16).toString("hex"),
			pid: process.pid,
			hostname: hostname(),
			processStartedAt: currentProcessStartedAt(),
			acquiredAt: now().toISOString(),
		};
		try {
			await mkdir(dirname(path), { recursive: true, mode: 0o700 });
			await writeFile(path, `${JSON.stringify(owner, null, "\t")}\n`, {
				flag: "wx",
				mode: 0o600,
			});
			return {
				owner,
				async release() {
					await releaseIfOwned(path, owner.nonce);
				},
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}

		let held: LockOwner | null = null;
		try {
			held = JSON.parse(await readFile(path, "utf8")) as LockOwner;
		} catch {
			held = null;
		}

		if (held && isStale(held)) {
			await removeOwnedLockDirectory(path, held.nonce);
			continue;
		}

		if (Date.now() >= deadline) {
			const owner2 = held ? `${held.hostname}/${held.pid}` : "unknown owner";
			throw new SessionLockError(
				`Session ${sessionId} is locked by ${owner2}.`,
				held && held.hostname === hostname() ? "session_locked" : "stale_lock_unrecoverable",
			);
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}

	function isStale(held: LockOwner): boolean {
		if (held.hostname !== hostname()) return false;
		if (!Number.isInteger(held.pid)) return false;
		if (isAlive(held.pid)) return false;
		const acquiredAt = Date.parse(held.acquiredAt);
		if (!Number.isFinite(acquiredAt)) return false;
		return Date.now() - acquiredAt >= staleAfterMs;
	}
}

async function releaseIfOwned(path: string, nonce: string): Promise<void> {
	let held: LockOwner | null = null;
	try {
		held = JSON.parse(await readFile(path, "utf8")) as LockOwner;
	} catch {
		return;
	}
	if (held?.nonce !== nonce) return;
	await removeOwnedLockDirectory(path, nonce);
}

async function removeOwnedLockDirectory(path: string, nonce: string): Promise<void> {
	const directory = dirname(path);
	const moved = `${directory}.remove-${randomBytes(8).toString("hex")}`;
	const { rename } = await import("node:fs/promises");
	try {
		await rename(directory, moved);
	} catch {
		return;
	}
	let movedOwner: LockOwner | null = null;
	try {
		movedOwner = JSON.parse(await readFile(`${moved}/${path.slice(directory.length + 1)}`, "utf8")) as LockOwner;
	} catch {
		movedOwner = null;
	}
	if (movedOwner?.nonce === nonce) {
		await rm(moved, { recursive: true, force: true });
		return;
	}
	try {
		await rename(moved, directory);
	} catch {
		// A new owner acquired the original path. Keep the displaced lock rather
		// than deleting a directory whose nonce no longer matches.
	}
}

export async function withSessionLock<T>(
	sessionId: SessionId,
	stateRoot: string,
	fn: (lock: SessionLock) => Promise<T>,
	options: AcquireOptions = {},
): Promise<T> {
	const lock = await acquireSessionLock(sessionId, stateRoot, options);
	try {
		return await fn(lock);
	} finally {
		await lock.release();
	}
}

export { newEventId, writeFileAtomic, stat };
