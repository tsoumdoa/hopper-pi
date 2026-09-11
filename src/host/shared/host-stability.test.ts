import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { afterEach, expect, it } from "vitest";
import { TaskJournal } from "./journal.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function fixture(mode: string) {
	const directory = mkdtempSync(join(tmpdir(), "hopper-host-stability-"));
	writeFileSync(join(directory, "index.html"), "Hopper");
	const path = join(directory, "journal.sqlite");
	const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./test-fixtures/host-stability.ts", import.meta.url)), mode, directory, path], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
	let stderr = "";
	child.stderr!.on("data", chunk => { stderr += chunk; });
	const exited = once(child, "exit");
	cleanup.push(async () => {
		if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
		await exited;
		rmSync(directory, { recursive: true, force: true });
	});
	const [ready] = await Promise.race([once(child, "message"), exited.then(() => { throw new Error(stderr); })]);
	return { child, exited, path, stderr: () => stderr, ...ready as { port: number; taskId: string } };
}

it("survives malformed frames before authentication and accepts a fresh authenticated client", async () => {
	const f = await fixture("socket");
	const connect = () => new WebSocket(`ws://127.0.0.1:${f.port}/ws-shared`, { origin: `http://127.0.0.1:${f.port}` });
	const bad = connect();
	await once(bad, "open");
	const closed = once(bad, "close");
	// A client frame must be masked. ws lets this test send an invalid frame.
	bad.send("invalid frame", { mask: false });
	await closed;
	expect(f.child.exitCode).toBeNull();
	expect((await fetch(`http://127.0.0.1:${f.port}/health`)).ok).toBe(true);
	const good = connect();
	await once(good, "open");
	const snapshot = once(good, "message");
	good.send(JSON.stringify({ type: "authenticate", token: "secret" }));
	expect(JSON.parse(String((await snapshot)[0]))).toEqual({ type: "shared_snapshot", snapshot: { ready: true } });
	good.terminate();
	f.child.send("stop");
	expect(await f.exited).toEqual([0, null]);
	expect(f.stderr()).not.toContain("Unhandled");
}, 15_000);

it.each([
	["cancel", "stop"], ["run", "stop"], ["cancel", "SIGTERM"], ["run", "SIGTERM"], ["run", "lifetime"],
])("bounds %s shutdown via %s and preserves unfinished work for recovery", async (mode, trigger) => {
	const f = await fixture(mode);
	if (trigger === "SIGTERM" && process.platform !== "win32") f.child.kill("SIGTERM");
	// Windows kill(SIGTERM) forcibly terminates Node without invoking its signal
	// handler. Ask the fixture to emit that event so the same shutdown path and
	// recovery assertions run here; POSIX still exercises actual signal delivery.
	else f.child.send(trigger);
	expect(await f.exited).toEqual([1, null]);
	expect(f.stderr()).toContain("cleanup exceeded 5 seconds");
	const journal = new TaskJournal(f.path);
	try {
		expect(journal.getTask(f.taskId)).toMatchObject({ state: "running", cancellation_requested: 1 });
		journal.recover();
		expect(journal.getTask(f.taskId)?.state).toBe("uncertain");
		expect(journal.hasQueuedTasks).toBe(false);
	} finally { journal.close(); }
}, 15_000);
