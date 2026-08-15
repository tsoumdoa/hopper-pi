import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { acquireSessionLock, SessionLockError, withSessionLock } from "./lock.js";
import { lockPath } from "./paths.js";

const SESSION = "hs_01LOCKTEST0000000000000000" as `hs_${string}`;

async function freshRoot(): Promise<string> {
	return mkdtemp(join(tmpdir(), "hopper-lock-"));
}

test("acquire and release round-trips the lock", async () => {
	const root = await freshRoot();
	const lock = await acquireSessionLock(SESSION, root, { timeoutMs: 1_000 });
	assert.ok(lock.owner.nonce.length > 0);
	await lock.release();
	const again = await acquireSessionLock(SESSION, root, { timeoutMs: 1_000 });
	await again.release();
});

test("a second writer cannot steal a live lock", async () => {
	const root = await freshRoot();
	const first = await acquireSessionLock(SESSION, root, { timeoutMs: 1_000 });
	await assert.rejects(
		acquireSessionLock(SESSION, root, { timeoutMs: 100 }),
		(error: SessionLockError) => {
			assert.equal(error.code, "session_locked");
			return true;
		},
	);
	await first.release();
});

test("release never deletes a replacement owner's lock", async () => {
	const root = await freshRoot();
	const first = await acquireSessionLock(SESSION, root, { timeoutMs: 1_000 });
	// Simulate a replacement owner overwriting the nonce.
	await writeFile(
		lockPath(root, SESSION),
		JSON.stringify({ ...first.owner, nonce: "replacement", pid: process.pid }),
		"utf8",
	);
	await first.release();
	const contents = JSON.parse(await readFile(lockPath(root, SESSION), "utf8")) as { nonce: string };
	assert.equal(contents.nonce, "replacement");
});

test("stale locks from dead same-host processes are reclaimed", async () => {
	const root = await freshRoot();
	const dead = await acquireSessionLock(SESSION, root, { timeoutMs: 1_000 });
	const staleTime = new Date(Date.now() - 10 * 60_000).toISOString();
	await writeFile(
		lockPath(root, SESSION),
		JSON.stringify({ ...dead.owner, pid: 999_999, acquiredAt: staleTime }),
		"utf8",
	);
	const reclaimed = await acquireSessionLock(SESSION, root, {
		timeoutMs: 2_000,
		isProcessAlive: () => false,
	});
	assert.notEqual(reclaimed.owner.nonce, dead.owner.nonce);
	await reclaimed.release();
});

test("young locks from dead processes are not reclaimed immediately", async () => {
	const root = await freshRoot();
	const dead = await acquireSessionLock(SESSION, root, { timeoutMs: 1_000 });
	await writeFile(
		lockPath(root, SESSION),
		JSON.stringify({ ...dead.owner, pid: 999_999, acquiredAt: new Date().toISOString() }),
		"utf8",
	);
	await assert.rejects(
		acquireSessionLock(SESSION, root, {
			timeoutMs: 100,
			isProcessAlive: () => false,
			staleAfterMs: 60_000,
		}),
		(error: SessionLockError) => error.code === "session_locked",
	);
});

test("cross-host locks require human cleanup", async () => {
	const root = await freshRoot();
	const foreign = await acquireSessionLock(SESSION, root, { timeoutMs: 1_000 });
	await writeFile(
		lockPath(root, SESSION),
		JSON.stringify({
			...foreign.owner,
			hostname: "other-host",
			pid: 999_999,
			acquiredAt: new Date(Date.now() - 10 * 60_000).toISOString(),
		}),
		"utf8",
	);
	await assert.rejects(
		acquireSessionLock(SESSION, root, {
			timeoutMs: 100,
			isProcessAlive: () => false,
		}),
		(error: SessionLockError) => error.code === "stale_lock_unrecoverable",
	);
});

test("withSessionLock releases even when the body throws", async () => {
	const root = await freshRoot();
	await assert.rejects(
		withSessionLock(SESSION, root, async () => {
			throw new Error("boom");
		}, { timeoutMs: 1_000 }),
		/boom/,
	);
	const fresh = await acquireSessionLock(SESSION, root, { timeoutMs: 1_000 });
	await fresh.release();
});
