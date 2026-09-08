import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ToolPolicyStore } from "./tool-policy-store.js";
import { ToolCredentials, type ProtectedCredentialBackend } from "./tool-credentials.js";
import type { ToolPolicyDescriptor } from "./tool-policy.js";

const inventory: ToolPolicyDescriptor[] = [{ id: "test", name: "test", owner: "hopper", parent: "hopper.rhino", defaultActive: true, requirements: [] }];
const directories: string[] = [];
const stores: ToolPolicyStore[] = [];
async function create() {
	const directory = await mkdtemp(join(tmpdir(), "hopper-policy-"));
	directories.push(directory);
	const store = new ToolPolicyStore(inventory, { directory });
	stores.push(store);
	return store;
}
afterEach(async () => { await Promise.all(stores.splice(0).map(store => store.close())); await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

describe("authoritative policy persistence", () => {
	it("drains lock operations on close and rejects new work", async () => {
		const store = await create();
		let entered!: () => void, resume!: () => void;
		const started = new Promise<void>(resolve => { entered = resolve; });
		const release = new Promise<void>(resolve => { resume = resolve; });
		const pending = store.withSnapshot(async () => { entered(); await release; });
		await started;
		let closed = false;
		const closing = store.close().then(() => { closed = true; });
		await expect(store.read()).rejects.toMatchObject({ code: "settings-unavailable" });
		expect(closed).toBe(false);
		resume();
		await pending;
		await closing;
		expect(closed).toBe(true);
		await rm(store.directory, { recursive: true, force: true });
		await expect(store.read()).rejects.toMatchObject({ code: "settings-unavailable" });
	});

	it("unsubscribing stops notifications without closing the store", async () => {
		const store = await create();
		const unsubscribe = store.subscribe(() => {});
		unsubscribe();
		expect((await store.read()).revision).toBe(0);
	});

	it("orders concurrent hosts and rejects stale edits even on other fields", async () => {
		const first = await create();
		const second = new ToolPolicyStore(inventory, { directory: first.directory });
		const initial = await first.read();
		const results = await Promise.all([
			first.update(initial, { target: "tools", id: "test", enabled: false }),
			second.update(initial, { target: "parents", id: "hopper.rhino", enabled: false }),
		]);
		expect(results.filter(result => result.ok)).toHaveLength(1);
		expect(results.find(result => !result.ok)).toMatchObject({ code: "conflict" });
		expect(await second.withSnapshot(snapshot => snapshot.revision)).toBe(1);
	});
	it("blocks interrupted initialization and missing settings; repair invalidates epochs", async () => {
		const store = await create();
		await writeFile(join(store.directory, "tool-settings.initialized"), "1");
		await expect(store.read()).rejects.toMatchObject({ code: "settings-unavailable" });
		const repaired = await store.repair();
		await rm(join(store.directory, "tool-settings.json"));
		await rm(join(store.directory, "tool-settings.initialized"));
		await expect(store.read()).rejects.toMatchObject({ code: "settings-unavailable" });
		const next = await store.repair();
		expect(next.epoch).not.toBe(repaired.epoch);
		expect(next.parents.firecrawl.enabled).toBe(false);
		expect(await store.update(repaired, { target: "tools", id: "test", enabled: true })).toMatchObject({ ok: false, code: "conflict" });
	});
	it("does not let a stale repair erase a healthy policy", async () => {
		const store = await create();
		const initial = await store.read();
		await store.update(initial, { target: "tools", id: "test", enabled: false });
		await expect(store.repair()).rejects.toMatchObject({ code: "settings-unavailable" });
		expect((await store.read()).tools.test.enabled).toBe(false);
	});
	it("preserves corrupt and future files until explicit repair", async () => {
		const store = await create();
		for (const text of ["{sentinel-secret", '{"schemaVersion":99}']) {
			await writeFile(join(store.directory, "tool-settings.json"), text);
			await expect(store.read()).rejects.toThrow("Tool settings are unavailable");
			expect(await readFile(join(store.directory, "tool-settings.json"), "utf8")).toBe(text);
		}
	});
	it("recovers a real native cross-process lock after owner death", async () => {
		const store = await create();
		const initial = await store.read();
		const script = `import {openLock,Lock} from '@lickle/lock'; await openLock(process.argv[1],Lock.Exclusive); console.log('locked'); setInterval(()=>{},1000);`;
		const child = spawn(process.execPath, ["--input-type=module", "-e", script, join(store.directory, "tool-settings.lock")], { stdio: ["ignore", "pipe", "pipe"] });
		try {
			await once(child.stdout!, "data");
			let admitted = false;
			const waiting = store.withSnapshot(snapshot => { admitted = true; return snapshot; });
			await new Promise(resolve => setTimeout(resolve, 75));
			expect(admitted).toBe(false);
			const exited = once(child, "exit");
			child.kill("SIGKILL");
			await exited;
			expect(await waiting).toEqual(initial);
		} finally { child.kill("SIGKILL"); }
	}, 10_000);
});

describe("credential publication", () => {
	it("does not publish a protected write superseded by a disable", async () => {
		const store = await create();
		const initial = await store.read();
		let finish!: () => void;
		let entered!: () => void;
		const started = new Promise<void>(resolve => { entered = resolve; });
		const entries = new Map<string, string>();
		const backend: ProtectedCredentialBackend = {
			read: async reference => entries.get(reference) ?? null,
			write: async (reference, secret) => { entered(); await new Promise<void>(resolve => { finish = resolve; }); entries.set(reference, secret); },
			remove: async reference => { entries.delete(reference); },
		};
		const credentials = new ToolCredentials(store, backend);
		const save = credentials.save(initial, "sentinel-secret", true);
		await started;
		await store.update(initial, { target: "parents", id: "firecrawl", enabled: false });
		finish();
		expect(await save).toMatchObject({ ok: false, code: "conflict" });
		expect(entries.size).toBe(0);
		expect(await readFile(join(store.directory, "tool-settings.json"), "utf8")).not.toContain("sentinel-secret");
	});
	it("commits removal before failed deletion and sanitizes backend errors", async () => {
		const store = await create();
		const credentials = new ToolCredentials(store, {
			read: async () => { throw new Error("sentinel-secret"); },
			write: async () => {}, remove: async () => { throw new Error("sentinel-secret"); },
		});
		const saved = await credentials.save(await store.read(), "key", true);
		expect(saved.ok).toBe(true);
		await expect(credentials.read(saved.snapshot)).rejects.not.toThrow("sentinel-secret");
		const removed = await credentials.remove(saved.snapshot);
		expect(removed).toMatchObject({ ok: true, deletionFailed: true, snapshot: { credentials: { firecrawl: { reference: null } } } });
		expect(await credentials.read(await store.read())).toBe(null);
	});
});
