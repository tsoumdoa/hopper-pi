import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { CREDENTIAL_STATUS_TIMEOUT_MS, ToolPolicyRuntime } from "./tool-policy-runtime.js";
import { ToolPolicyStore } from "./tool-policy-store.js";
import { ToolCredentials } from "./tool-credentials.js";
import { HOPPER_POLICY_INVENTORY } from "../tools/policy-inventory.js";
import { admitCurrentToolDispatch } from "./tool-policy-context.js";
import { HopperRpcClient, type DealerSocket } from "../infra/rpc-client.js";

const backend = vi.hoisted(() => ({ online: true, probe: vi.fn(), refresh: vi.fn() }));
vi.mock("../infra/backend-status.js", () => ({
	getCachedBackendStatus: () => ({ online: backend.online }),
	probeBackend: () => backend.probe(),
	refreshBackendIfOffline: () => backend.refresh(),
}));

function deferred<T = void>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => { resolve = done; });
	return { promise, resolve };
}
const cleanups: (() => Promise<void>)[] = [];
beforeEach(() => {
	backend.online = true;
	backend.probe.mockReset().mockImplementation(async () => { backend.online = true; });
	backend.refresh.mockReset().mockResolvedValue(true);
});
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function fixture(progressive = false) {
	const directory = await mkdtemp(join(tmpdir(), "hopper-runtime-policy-"));
	const store = new ToolPolicyStore(HOPPER_POLICY_INVENTORY, { directory });
	// Deliberately miss notifications: execution must still read the authoritative store.
	vi.spyOn(store, "subscribe").mockImplementation(() => () => {});
	const secrets = new Map<string, string>();
	const credentials = new ToolCredentials(store, "firecrawl", {
		read: async id => secrets.get(id) ?? null,
		write: async (id, value) => { secrets.set(id, value); },
		remove: async id => { secrets.delete(id); },
	});
	const runtime = new ToolPolicyRuntime({ store, credentials: new Map([["firecrawl", credentials]]) });
	cleanups.push(async () => { await runtime.close(); await rm(directory, { recursive: true, force: true }); });
	let active: string[] = [];
	const registered = new Map<string, ToolDefinition>();
	const pi = {
		getAllTools: () => [...registered.values()], getActiveTools: () => active,
		setActiveTools: vi.fn((names: string[]) => { active = names; }),
		registerTool: (tool: ToolDefinition) => { registered.set(tool.name, tool); },
	} as unknown as ExtensionAPI;
	const context = (id: string) => ({ sessionManager: { getSessionId: () => id }, hasUI: true, model: { input: ["text"] } }) as unknown as ExtensionContext;
	let ctx = context("first");
	runtime.bind(pi, ctx, progressive);
	const tool = (name: string, execute: ToolDefinition["execute"]) => {
		runtime.register(pi, { name, label: name, description: name, parameters: Type.Object({}), execute });
		return registered.get(name)!;
	};
	const invoke = (definition: ToolDefinition) => definition.execute("test", {}, undefined, undefined, ctx);
	const patch = async (id: string, enabled: boolean, target: "tools" | "parents" = "tools") => {
		const result = await store.update(await store.read(), { id, enabled, target });
		expect(result.ok).toBe(true);
	};
	const enableFirecrawl = async () => {
		const saved = await credentials.save(await store.read(), "test-secret", true);
		expect(saved.ok).toBe(true);
	};
	return { runtime, store, credentials, pi, tool, invoke, patch, enableFirecrawl,
		replaceSession: () => { ctx = context("replacement"); runtime.bind(pi, ctx, progressive); } };
}

const completed = () => ({ content: [{ type: "text" as const, text: "done" }], details: {} });

async function withoutCredentialTimeout<T>(pending: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([pending, new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error("Still waiting on obsolete credentials")), 500);
		})]);
	} finally { clearTimeout(timer); }
}

describe("shared runtime policy admissions", () => {
	it.each(["local-save", "watcher", "missed-watcher"])("releases a credential read started before Firecrawl was disabled via %s", async source => {
		const f = await fixture();
		f.tool("rh_run_script", async () => completed());
		f.tool("web_search", async () => completed());
		await f.enableFirecrawl();
		await f.runtime.reconcile();
		const started = deferred(), resume = deferred<string | null>();
		vi.spyOn(f.credentials, "read").mockImplementationOnce(() => { started.resolve(); return resume.promise; });
		const publish = vi.fn();
		f.runtime.onChange = publish;
		const obsolete = f.runtime.reconcile();
		await started.promise;
		try {
			if (source === "local-save") {
				const result = await withoutCredentialTimeout(f.runtime.updateToolSettings({
					type: "patch", expected: await f.store.read(), patch: { target: "parents", id: "firecrawl", enabled: false },
				}));
				expect(result.ok).toBe(true);
			} else {
				await f.patch("firecrawl", false, "parents");
				if (source === "watcher") {
					vi.mocked(f.store.subscribe).mock.calls[0][0](await f.store.read());
					await withoutCredentialTimeout(obsolete);
				}
			}
			await withoutCredentialTimeout(f.runtime.reconcile(true));
			await obsolete;
			expect(f.pi.getActiveTools()).toContain("rh_run_script");
			expect(f.pi.getActiveTools()).not.toContain("web_search");
			const notifications = publish.mock.calls.length;
			resume.resolve("late-secret");
			await new Promise(resolve => setImmediate(resolve));
			expect(publish).toHaveBeenCalledTimes(notifications);
			expect(f.pi.getActiveTools()).not.toContain("web_search");
		} finally { resume.resolve(null); await obsolete; }
	});

	it("session replacement releases an old credential wait and ignores its late completion", async () => {
		const f = await fixture();
		f.tool("rh_run_script", async () => completed());
		f.tool("web_search", async () => completed());
		await f.enableFirecrawl();
		await f.runtime.reconcile();
		const started = deferred(), resume = deferred<string | null>();
		vi.spyOn(f.credentials, "read").mockImplementationOnce(() => { started.resolve(); return resume.promise; });
		const obsolete = f.runtime.reconcile().catch(error => error);
		await started.promise;
		try {
			f.replaceSession();
			await withoutCredentialTimeout(f.runtime.reconcile(true));
			expect(await obsolete).toMatchObject({ code: "cancelled" });
			expect(f.pi.getActiveTools()).toEqual(expect.arrayContaining(["rh_run_script", "web_search"]));
			const publish = vi.fn();
			f.runtime.onChange = publish;
			resume.resolve(null);
			await new Promise(resolve => setImmediate(resolve));
			expect(publish).not.toHaveBeenCalled();
			expect(f.pi.getActiveTools()).toContain("web_search");
		} finally { resume.resolve(null); await obsolete; }
	});

	it("shutdown drains reconciliation without waiting for native credentials", async () => {
		const f = await fixture();
		await f.enableFirecrawl();
		const started = deferred(), resume = deferred<string | null>();
		vi.spyOn(f.credentials, "read").mockImplementationOnce(() => { started.resolve(); return resume.promise; });
		const obsolete = f.runtime.reconcile().catch(error => error);
		await started.promise;
		try { await withoutCredentialTimeout(f.runtime.close()); }
		finally { resume.resolve(null); await obsolete; }
	});

	it("times out credential status and keeps Rhino available without adopting a late result", async () => {
		const f = await fixture();
		f.tool("rh_run_script", async () => completed());
		f.tool("web_search", async () => completed());
		await f.enableFirecrawl();
		await f.runtime.reconcile();
		const started = deferred(), resume = deferred<string | null>();
		vi.spyOn(f.credentials, "read").mockImplementationOnce(() => { started.resolve(); return resume.promise; });
		const publish = vi.fn();
		f.runtime.onChange = publish;
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const pending = f.runtime.reconcile(true);
		try {
			await started.promise;
			await vi.advanceTimersByTimeAsync(CREDENTIAL_STATUS_TIMEOUT_MS);
			await pending;
			expect(f.pi.getActiveTools()).toContain("rh_run_script");
			expect(f.pi.getActiveTools()).not.toContain("web_search");
			expect(publish.mock.calls.at(-1)?.[0].settings.parents.find((parent: { id: string }) => parent.id === "firecrawl")?.credential?.status).toBe("unavailable");
			resume.resolve("late-secret");
			await new Promise(resolve => setImmediate(resolve));
			expect(publish).toHaveBeenCalledOnce();
			await f.runtime.reconcile(true);
			expect(f.pi.getActiveTools()).toContain("web_search");
		} finally { resume.resolve(null); vi.useRealTimers(); await pending; }
	});

	it.each(["parent", "children"])("does not wait for protected storage when Firecrawl's %s is disabled", async disabled => {
		const f = await fixture();
		f.tool("rh_run_script", async () => completed());
		f.tool("web_search", async () => completed());
		await f.enableFirecrawl();
		if (disabled === "parent") await f.patch("firecrawl", false, "parents");
		else {
			await f.patch("firecrawl.tool.search", false);
			await f.patch("firecrawl.tool.fetch", false);
		}
		const resume = deferred<string | null>();
		const read = vi.spyOn(f.credentials, "read").mockImplementation(() => resume.promise);
		const pending = f.runtime.reconcile(true);
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const result = await Promise.race([pending.then(() => "ready"), new Promise(resolve => { timer = setTimeout(() => resolve("blocked"), 100); })]);
			expect(result).toBe("ready");
			expect(f.pi.getActiveTools()).toContain("rh_run_script");
			expect(f.pi.getActiveTools()).not.toContain("web_search");
			expect((await f.runtime.getToolSettings()).settings?.parents.find(parent => parent.id === "firecrawl")?.credential?.status).toBe("configured");
			expect(read).not.toHaveBeenCalled();
		} finally { clearTimeout(timer); resume.resolve(null); await pending; }
	});

	it("reuses schemas and suppresses unchanged exposure and notifications while publishing runtime changes", async () => {
		const f = await fixture();
		f.tool("rh_run_script", async () => completed());
		f.tool("rh_capture_view", async () => completed());
		const publish = vi.fn();
		f.runtime.onChange = publish;
		await f.runtime.reconcile();
		const first = await f.runtime.getToolSettings();
		await f.runtime.reconcile(true);
		const next = await f.runtime.getToolSettings();
		expect(publish).toHaveBeenCalledOnce();
		expect(f.pi.setActiveTools).toHaveBeenCalledOnce();
		expect(next.tools.find(tool => tool.name === "rh_run_script")!.parameters).toBe(first.tools.find(tool => tool.name === "rh_run_script")!.parameters);
		f.runtime.setContext({ sessionManager: { getSessionId: () => "first" }, hasUI: true, model: { input: ["text", "image"] } } as unknown as ExtensionContext);
		await f.runtime.reconcile(true);
		expect(f.pi.getActiveTools()).toContain("rh_capture_view");
		expect(publish).toHaveBeenCalledTimes(2);
		expect(publish.mock.calls[1][0].settings.version).toEqual(first.settings?.version);
		await f.patch("hopper.tool.rh_run_script", false);
		await f.runtime.reconcile();
		expect(f.pi.getActiveTools()).not.toContain("rh_run_script");
		expect(publish).toHaveBeenCalledTimes(3);
	});

	it("does not treat a disabled plugin's saved reference as verified after a concurrent enable", async () => {
		const f = await fixture();
		f.tool("web_search", async () => completed());
		await f.enableFirecrawl();
		await f.patch("firecrawl", false, "parents");
		const started = deferred(), resume = deferred();
		const read = f.store.read.bind(f.store);
		vi.spyOn(f.store, "read").mockImplementationOnce(async () => {
			const snapshot = await read();
			started.resolve();
			await resume.promise;
			return snapshot;
		});
		const pending = f.runtime.reconcile();
		await started.promise;
		await f.patch("firecrawl", true, "parents");
		resume.resolve();
		await pending;
		expect(f.pi.getActiveTools()).not.toContain("web_search");
		await f.runtime.reconcile();
		expect(f.pi.getActiveTools()).toContain("web_search");
	});

	it("uses one preflight read for a ready tool and refuses execution when backend recovery fails", async () => {
		const f = await fixture();
		const execute = vi.fn(async () => completed());
		const tool = f.tool("rh_run_script", execute);
		await f.runtime.reconcile();
		const admission = vi.spyOn(f.store, "withSnapshot");
		await f.invoke(tool);
		expect(admission).toHaveBeenCalledOnce();
		expect(execute).toHaveBeenCalledOnce();
		backend.online = false;
		backend.probe.mockResolvedValue(undefined);
		expect((await f.invoke(tool)).details).toMatchObject({ code: "backend-unavailable" });
		expect(backend.probe).toHaveBeenCalledOnce();
		expect(execute).toHaveBeenCalledOnce();
	});

	it.each([false, true])("samples credentials once and publishes the returned save snapshot while busy=%s", async busy => {
		const f = await fixture();
		f.tool("web_search", async () => completed());
		await f.enableFirecrawl();
		await f.runtime.reconcile();
		f.runtime.setBusy(busy);
		const status = vi.spyOn(f.credentials, "status");
		const read = vi.spyOn(f.credentials, "read");
		const publish = vi.fn();
		f.runtime.onChange = publish;
		const result = await f.runtime.updateToolSettings({
			type: "patch", expected: await f.store.read(),
			patch: { target: "tools", id: "hopper.tool.rh_run_script", enabled: false },
		});
		expect(result.ok).toBe(true);
		expect(status).toHaveBeenCalledOnce();
		expect(read).toHaveBeenCalledOnce();
		expect(publish).toHaveBeenCalledOnce();
		expect(publish.mock.calls[0][0]).toBe(result.snapshot);
		expect(result.snapshot.settings?.parents.find(parent => parent.id === "firecrawl")?.credential?.status).toBe("configured");
	});

	it("activates Rhino tools without consulting protected credentials", async () => {
		const f = await fixture(true);
		f.tool("rh_run_script", async () => completed());
		await f.runtime.reconcile();
		const status = vi.spyOn(f.credentials, "status");
		const read = vi.spyOn(f.credentials, "read");
		await f.runtime.activate("hopper.tool.rh_run_script");
		expect(status).not.toHaveBeenCalled();
		expect(read).not.toHaveBeenCalled();
		await f.runtime.reconcile();
		expect(f.pi.getActiveTools()).toContain("rh_run_script");
	});

	it("does not reuse credential status after a concurrent key replacement", async () => {
		const f = await fixture();
		f.tool("web_search", async () => completed());
		await f.enableFirecrawl();
		const started = deferred(), resume = deferred();
		vi.spyOn(f.credentials, "status").mockImplementationOnce(async () => {
			started.resolve();
			await resume.promise;
			return "configured";
		});
		const publish = vi.fn();
		f.runtime.onChange = publish;
		const pending = f.runtime.reconcile();
		await started.promise;
		const saved = await f.credentials.save(await f.store.read(), "replacement-secret", false);
		expect(saved.ok).toBe(true);
		resume.resolve();
		await pending;
		expect(f.pi.getActiveTools()).not.toContain("web_search");
		expect(publish).toHaveBeenCalledOnce();
		expect(publish.mock.calls[0][0].settings.parents.find((parent: { id: string }) => parent.id === "firecrawl")?.credential?.status).toBe("unavailable");
	});

	it("revokes execution after a paused backend prerequisite despite missed notifications", async () => {
		const f = await fixture();
		const execute = vi.fn(async () => completed());
		const tool = f.tool("rh_run_script", execute);
		await f.runtime.reconcile();
		backend.online = false;
		const started = deferred(), resume = deferred();
		backend.probe.mockImplementation(async () => { started.resolve(); await resume.promise; backend.online = true; });
		const pending = f.invoke(tool);
		await started.promise;
		await f.patch("hopper.tool.rh_run_script", false);
		resume.resolve();
		expect((await pending).details).toMatchObject({ code: "disabled-by-user" });
		expect(execute).not.toHaveBeenCalled();
	});


	it("admits each dispatch in a batch and blocks the later script", async () => {
		const f = await fixture();
		const dispatched: number[] = [];
		const tool = f.tool("rh_run_script", async () => {
			for (const script of [1, 2]) {
				await admitCurrentToolDispatch();
				dispatched.push(script);
				if (script === 1) await f.patch("hopper.tool.rh_run_script", false);
			}
			return completed();
		});
		await f.runtime.reconcile();
		expect((await f.invoke(tool)).details).toMatchObject({ code: "disabled-by-user" });
		expect(dispatched).toEqual([1]);
	});

	it("disable then enable cannot revive a stale session definition", async () => {
		const f = await fixture();
		const execute = vi.fn(async () => completed());
		const tool = f.tool("rh_run_script", execute);
		await f.runtime.reconcile();
		await f.patch("hopper.tool.rh_run_script", false);
		await f.patch("hopper.tool.rh_run_script", true);
		expect((await f.invoke(tool)).details).toMatchObject({ code: "pending-exposure" });
		expect(execute).not.toHaveBeenCalled();
		await f.runtime.reconcile();
		await f.invoke(tool);
		expect(execute).toHaveBeenCalledOnce();
	});

	it("the actual RPC socket checks ALS admission for each send in a batch", async () => {
		const f = await fixture();
		const sent: unknown[] = [];
		let receive!: (frames: readonly Uint8Array[]) => void;
		let disconnect!: (error: Error) => void;
		const socket: DealerSocket = {
			connect: () => {},
			receive: () => new Promise((resolve, reject) => { receive = resolve; disconnect = reject; }),
			close: () => { disconnect?.(new Error("closed")); },
			send: async payload => {
				const request = JSON.parse(new TextDecoder().decode(payload));
				sent.push(request);
				await f.patch("hopper.tool.rh_run_script", false);
				receive([new TextEncoder().encode(JSON.stringify({
					protocolVersion: 2, lifecycleInstanceId: request.lifecycleInstanceId, requestId: request.requestId,
					operation: request.operation, result: { class: "completed", reasonCode: "OK", data: {} },
				}))]);
			},
		};
		const client = new HopperRpcClient({ endpoint: "tcp://127.0.0.1:5557", lifecycleInstanceId: "test-policy", token: "a".repeat(40), socketFactory: { create: () => socket } });
		const tool = f.tool("rh_run_script", async () => {
			await client.call("getCurrentCanvas", {});
			await client.call("getCurrentCanvas", {});
			return completed();
		});
		try {
			await f.runtime.reconcile();
			expect((await f.invoke(tool)).details).toMatchObject({ code: "disabled-by-user" });
			expect(sent).toHaveLength(1);
			expect(client.pendingCount).toBe(0);
		} finally { await client.close(); }
	});

	it("an old Firecrawl callback cannot adopt a replacement session", async () => {
		const f = await fixture();
		const started = deferred(), resume = deferred();
		const dispatch = vi.fn();
		const tool = f.tool("web_search", async () => {
			started.resolve();
			await resume.promise;
			await f.runtime.admitPlugin("firecrawl", "web_search");
			dispatch();
			return completed();
		});
		await f.enableFirecrawl();
		await f.runtime.reconcile();
		const pending = f.invoke(tool);
		await started.promise;
		f.replaceSession();
		await f.runtime.reconcile();
		resume.resolve();
		expect((await pending).details).toMatchObject({ code: "cancelled" });
		expect(dispatch).not.toHaveBeenCalled();
	});

	it("does not dispatch a local tool after session replacement during lock release", async () => {
		const f = await fixture();
		const execute = vi.fn(async () => completed());
		const tool = f.tool("rh_script", execute);
		await f.runtime.reconcile();
		const withSnapshot = f.store.withSnapshot.bind(f.store);
		vi.spyOn(f.store, "withSnapshot").mockImplementation(async fn => {
			const result = await withSnapshot(fn);
			// Replace the session during asynchronous release of the preflight lock.
			f.replaceSession();
			return result;
		});
		expect((await f.invoke(tool)).details).toMatchObject({ code: "cancelled" });
		expect(execute).not.toHaveBeenCalled();
	});

	it("old discovery work cannot activate tools in a replacement session", async () => {
		const f = await fixture(true);
		const started = deferred(), resume = deferred();
		const discovery = f.tool("hopper_search_tools", async () => {
			await f.runtime.allowedToolNames();
			started.resolve();
			await resume.promise;
			await f.runtime.activate("firecrawl.tool.search");
			return completed();
		});
		f.tool("web_search", async () => completed());
		await f.enableFirecrawl();
		await f.runtime.reconcile();
		const pending = f.invoke(discovery);
		await started.promise;
		f.replaceSession();
		await f.runtime.reconcile();
		resume.resolve();
		expect((await pending).details).toMatchObject({ code: "cancelled" });
		await f.runtime.reconcile();
		expect(f.pi.getActiveTools()).not.toContain("web_search");
	});

	it("key removal during a protected read blocks dispatch", async () => {
		const f = await fixture();
		f.tool("web_search", async () => completed());
		await f.enableFirecrawl();
		await f.runtime.reconcile();
		const started = deferred(), resume = deferred();
		const read = f.credentials.read.bind(f.credentials);
		vi.spyOn(f.credentials, "read").mockImplementationOnce(async snapshot => { const key = await read(snapshot); started.resolve(); await resume.promise; return key; });
		const pending = expect(f.runtime.admitPlugin("firecrawl", "web_search")).rejects.toMatchObject({ code: "credential-changed" });
		await started.promise;
		await f.credentials.remove(await f.store.read());
		resume.resolve();
		await pending;
	});

	it("idle reconciliation cannot update exposure after model generation starts", async () => {
		const f = await fixture();
		f.tool("web_search", async () => completed());
		await f.runtime.reconcile();
		expect(f.pi.getActiveTools()).not.toContain("web_search");
		await f.enableFirecrawl();
		const started = deferred(), resume = deferred();
		vi.spyOn(f.credentials, "status").mockImplementationOnce(async () => { started.resolve(); await resume.promise; return "configured"; });
		const pending = f.runtime.reconcile();
		await started.promise;
		f.runtime.setBusy(true);
		resume.resolve();
		await pending;
		expect(f.pi.getActiveTools()).not.toContain("web_search");
	});

	it("manual activation rejects unavailable tools", async () => {
		const f = await fixture(true);
		f.tool("rh_capture_view", async () => completed());
		await f.runtime.reconcile();
		await expect(f.runtime.activate("hopper.tool.rh_capture_view")).rejects.toBeDefined();
		expect(f.pi.getActiveTools()).not.toContain("rh_capture_view");
	});

	it("pending manual activation cannot survive disable then enable during prerequisites", async () => {
		const f = await fixture(true);
		f.tool("web_search", async () => completed());
		await f.enableFirecrawl();
		await f.runtime.reconcile();
		const started = deferred(), resume = deferred();
		vi.spyOn(f.credentials, "status").mockImplementationOnce(async () => { started.resolve(); await resume.promise; return "configured"; });
		const pending = expect(f.runtime.activate("firecrawl.tool.search")).rejects.toMatchObject({ code: "activation-superseded" });
		await started.promise;
		await f.patch("firecrawl", false, "parents");
		await f.patch("firecrawl", true, "parents");
		resume.resolve();
		await pending;
		await f.runtime.reconcile();
		expect(f.pi.getActiveTools()).not.toContain("web_search");
	});

	it("shows unrelated tools without policy IDs and preserves their exposure", async () => {
		const f = await fixture();
		f.pi.registerTool({ name: "other_extension", label: "Other", description: "Another extension", parameters: Type.Object({}), execute: async () => completed() });
		f.pi.setActiveTools(["other_extension"]);
		await f.runtime.reconcile();
		const entry = (await f.runtime.getToolSettings()).tools.find(tool => tool.name === "other_extension");
		expect(entry).toMatchObject({ name: "other_extension", active: true });
		expect(entry?.id).toBeUndefined();
		expect(f.pi.getActiveTools()).toContain("other_extension");
	});
});
