import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { ToolPolicyRuntime } from "./tool-policy-runtime.js";
import { ToolPolicyStore } from "./tool-policy-store.js";
import { ToolCredentials } from "./tool-credentials.js";
import { HOPPER_POLICY_INVENTORY } from "../tools/policy-inventory.js";
import { withBackendGuard } from "../tools/with-backend-guard.js";
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
	const credentials = new ToolCredentials(store, {
		read: async id => secrets.get(id) ?? null,
		write: async (id, value) => { secrets.set(id, value); },
		remove: async id => { secrets.delete(id); },
	});
	const runtime = new ToolPolicyRuntime({ store, credentials });
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

describe("shared runtime policy admissions", () => {
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
		expect(result.snapshot.settings?.credential).toBe("configured");
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
		expect(publish.mock.calls[0][0].settings.credential).toBe("unavailable");
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

	it("checks again after withBackendGuard refresh", async () => {
		const f = await fixture();
		const execute = vi.fn(async () => completed());
		const guarded = withBackendGuard({ name: "rh_run_script", label: "Script", description: "Script", parameters: Type.Object({}), execute });
		const tool = f.tool(guarded.name, guarded.execute);
		await f.runtime.reconcile();
		const started = deferred(), resume = deferred();
		backend.refresh.mockImplementation(async () => { started.resolve(); await resume.promise; return true; });
		const pending = f.invoke(tool);
		await started.promise;
		await f.patch("hopper.rhino", false, "parents");
		resume.resolve();
		expect((await pending).details).toMatchObject({ code: "parent-disabled" });
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
			await f.runtime.admitFirecrawl("web_search");
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
		let reads = 0;
		vi.spyOn(f.store, "withSnapshot").mockImplementation(async fn => {
			const result = await withSnapshot(fn);
			// Preflight is the first read, final admission is the second. Model the
			// asynchronous lock release after its permission callback succeeded.
			if (++reads === 2) f.replaceSession();
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
		const pending = expect(f.runtime.admitFirecrawl("web_search")).rejects.toMatchObject({ code: "credential-changed" });
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
