import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { firecrawlPlugin } from "./firecrawl/index.js";
import { validatePlugins, type ToolPlugin } from "./types.js";
import { ToolPolicyRuntime } from "../services/tool-policy-runtime.js";
import { ToolPolicyStore } from "../services/tool-policy-store.js";
import { ToolCredentials } from "../services/tool-credentials.js";
import { createPolicyDefaults, publishPluginCredential, patchPolicy } from "../services/tool-policy.js";
import { BUILTIN_POLICY_INVENTORY } from "../tools/policy-inventory.js";
import { buildCatalogSizeReport } from "../tools/catalog.js";

vi.mock("../infra/backend-status.js", () => ({ getCachedBackendStatus: () => ({ online: true }), probeBackend: async () => {} }));
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const done = () => ({ content: [{ type: "text" as const, text: "done" }], details: {} });

function examplePlugin() {
	const request = vi.fn();
	const abortAll = vi.fn();
	const abortTool = vi.fn();
	const plugin: ToolPlugin = {
		id: "example", name: "Example", description: "Example service", defaultEnabled: false,
		keywords: ["example"], credential: { label: "Example API key", notice: "Requests go to Example." },
		inventory: [
			{ id: "example.tool.lookup", name: "example_lookup", owner: "example", parent: "example", defaultActive: false, requirements: ["credential"] },
			{ id: "example.tool.help", name: "example_help", owner: "example", parent: "example", defaultActive: true, requirements: [] },
		],
		create: context => ({
			tools: ["example_lookup", "example_help"].map(name => ({ name, label: name, description: name, parameters: Type.Object({}),
				execute: async (_id, _params, signal) => {
					const admission = await context.admit(name, signal);
					request(name, admission.apiKey);
					return done();
				},
			})), abortAll, abortTool,
		}),
	};
	return { plugin, request, abortAll, abortTool };
}
async function directory() {
	const path = await mkdtemp(join(tmpdir(), "hopper-plugins-"));
	cleanups.push(() => rm(path, { recursive: true, force: true }));
	return path;
}
async function fixture(plugins: readonly ToolPlugin[], path = "") {
	const inventory = [...BUILTIN_POLICY_INVENTORY, ...plugins.flatMap(plugin => plugin.inventory)];
	const store = new ToolPolicyStore(inventory, { directory: path || await directory(), plugins });
	vi.spyOn(store, "subscribe").mockImplementation(() => () => {});
	const secrets = new Map<string, Map<string, string>>();
	const credentials = new Map(plugins.filter(plugin => plugin.credential).map(plugin => {
		const entries = new Map<string, string>(); secrets.set(plugin.id, entries);
		return [plugin.id, new ToolCredentials(store, plugin.id, {
			read: async reference => entries.get(reference) ?? null,
			write: async (reference, key) => { entries.set(reference, key); },
			remove: async reference => { entries.delete(reference); },
		})] as const;
	}));
	const runtime = new ToolPolicyRuntime({ store, credentials });
	cleanups.push(() => runtime.close());
	let active: string[] = [];
	const registered = new Map<string, ToolDefinition>();
	const pi = { getAllTools: () => [...registered.values()], getActiveTools: () => active,
		setActiveTools: (names: string[]) => { active = names; }, registerTool: (tool: ToolDefinition) => { registered.set(tool.name, tool); },
	} as unknown as ExtensionAPI;
	const ctx = { sessionManager: { getSessionId: () => store.directory }, hasUI: true, model: { input: ["text"] } } as unknown as ExtensionContext;
	runtime.bind(pi, ctx, false);
	runtime.registerPlugins(pi);
	await runtime.reconcile();
	return { runtime, store, credentials, secrets, pi, registered, ctx,
		invoke: (name: string) => registered.get(name)!.execute("test", {}, undefined, undefined, ctx),
		save: async (pluginId: string, key: string) => runtime.updateToolSettings({ type: "credential", pluginId, expected: await store.read(), action: "save-and-enable", key }),
	};
}

describe("bundled plugin contract", () => {
	it("registers a second provider, publishes its controls, and isolates credentials and cancellation", async () => {
		const example = examplePlugin();
		const f = await fixture([firecrawlPlugin, example.plugin]);
		expect(f.pi.getAllTools().map(tool => tool.name)).toEqual(["web_search", "web_fetch", "example_lookup", "example_help"]);
		expect(buildCatalogSizeReport(f.runtime.pluginCatalog).byGroup["plugin:example"].count).toBe(2);
		const saved = await f.save("example", "example-secret");
		expect(saved.ok).toBe(true);
		expect(saved.snapshot.settings?.parents.find(parent => parent.id === "example")).toMatchObject({ name: "Example", enabled: true, credential: { label: "Example API key", status: "configured" } });
		expect((await f.store.read()).parents.firecrawl.enabled).toBe(false);
		expect(f.pi.getActiveTools()).toEqual(["example_lookup", "example_help"]);
		await f.invoke("example_lookup");
		expect(example.request).toHaveBeenLastCalledWith("example_lookup", "example-secret");
		await expect(f.runtime.admitPlugin("example", "web_search")).rejects.toMatchObject({ code: "plugin-tool-mismatch" });
		await f.save("firecrawl", "firecrawl-secret");
		expect(await f.credentials.get("firecrawl")!.read(await f.store.read())).toBe("firecrawl-secret");
		expect(await f.credentials.get("example")!.read(await f.store.read())).toBe("example-secret");
		example.abortAll.mockClear(); example.abortTool.mockClear();
		const removed = await f.runtime.updateToolSettings({ type: "credential", pluginId: "firecrawl", expected: await f.store.read(), action: "remove" });
		expect(removed.ok).toBe(true);
		expect(example.abortAll).not.toHaveBeenCalled(); expect(example.abortTool).not.toHaveBeenCalled();
		await f.invoke("example_lookup");
		expect(example.request).toHaveBeenLastCalledWith("example_lookup", "example-secret");
		await f.runtime.updateToolSettings({ type: "patch", expected: await f.store.read(), patch: { target: "tools", id: "example.tool.lookup", enabled: false } });
		expect(example.abortTool).toHaveBeenCalledWith("example_lookup");
		const calls = example.request.mock.calls.length;
		expect(await f.invoke("example_lookup")).toMatchObject({ isError: true });
		expect(example.request).toHaveBeenCalledTimes(calls);
		await f.runtime.updateToolSettings({ type: "patch", expected: await f.store.read(), patch: { target: "parents", id: "example", enabled: false } });
		expect(example.abortAll).toHaveBeenCalled();
		expect(JSON.stringify(await f.runtime.getToolSettings())).not.toContain("secret");
	});

	it("keeps a provider admission valid when another provider replaces its key", async () => {
		const example = examplePlugin();
		const f = await fixture([firecrawlPlugin, example.plugin]);
		await f.save("firecrawl", "firecrawl-key");
		await f.save("example", "example-key");
		let started!: () => void;
		let resume!: () => void;
		const reading = new Promise<void>(resolve => { started = resolve; });
		const released = new Promise<void>(resolve => { resume = resolve; });
		const service = f.credentials.get("example")!;
		const read = service.read.bind(service);
		vi.spyOn(service, "read").mockImplementationOnce(async snapshot => {
			const key = await read(snapshot); started(); await released; return key;
		});
		const admission = f.runtime.admitPlugin("example", "example_lookup");
		await reading;
		try { expect((await f.save("firecrawl", "replacement-key")).ok).toBe(true); }
		finally { resume(); }
		expect(await admission).toEqual({ apiKey: "example-key" });
	});

	it("reset disconnects every provider while preserving retired preferences", async () => {
		const example = examplePlugin();
		const f = await fixture([firecrawlPlugin, example.plugin]);
		await f.save("firecrawl", "firecrawl-key");
		await f.save("example", "example-key");
		const before = await f.store.read();
		await f.runtime.close();
		const reduced = await fixture([firecrawlPlugin], f.store.directory);
		const result = await reduced.runtime.updateToolSettings({ type: "reset", expected: await reduced.store.read() });
		expect(result.ok).toBe(true);
		const after = await reduced.store.read();
		for (const id of ["firecrawl", "example"]) expect(after.credentials[id]).toEqual({ reference: null, generation: before.credentials[id].generation + 1 });
		expect(after.parents.example).toEqual(before.parents.example);
		expect(after.parents.firecrawl.enabled).toBe(false);
	});

	it("enables credential-free tools in a mixed plugin while keyed tools remain blocked", async () => {
		const example = examplePlugin();
		const f = await fixture([example.plugin]);
		const result = await f.runtime.updateToolSettings({ type: "patch", expected: await f.store.read(), patch: { target: "parents", id: "example", enabled: true } });
		expect(result.ok).toBe(true);
		expect(f.pi.getActiveTools()).toEqual(["example_help"]);
		await f.invoke("example_help");
		expect(example.request).toHaveBeenCalledExactlyOnceWith("example_help", "");
		expect(await f.invoke("example_lookup")).toMatchObject({ isError: true });
		expect(example.request).toHaveBeenCalledTimes(1);
		expect(result.snapshot.tools.find(tool => tool.name === "example_lookup")?.status).toBe("api-key-required");
	});

	it("activates a credential-free tool without sampling its plugin's credential store", async () => {
		const example = examplePlugin();
		const plugin = { ...example.plugin, inventory: example.plugin.inventory.map(tool => ({ ...tool, defaultActive: false })) };
		const f = await fixture([plugin]);
		f.runtime.bind(f.pi, f.ctx, true);
		await f.save("example", "example-secret");
		expect(f.pi.getActiveTools()).toEqual([]);
		const status = vi.spyOn(f.credentials.get("example")!, "status").mockImplementation(() => new Promise(() => {}));
		await f.runtime.activateByName("example_help");
		expect(status).not.toHaveBeenCalled();
		status.mockRestore();
		await f.runtime.reconcile();
		expect(f.pi.getActiveTools()).toEqual(["example_help"]);
		await f.invoke("example_help");
		expect(example.request).toHaveBeenCalledExactlyOnceWith("example_help", "");
	});

	it("supports a plugin with no credential setup", async () => {
		const example = examplePlugin();
		const plugin = { ...example.plugin, credential: undefined, inventory: example.plugin.inventory.map(tool => ({ ...tool, requirements: [] })) };
		const f = await fixture([plugin]);
		expect((await f.store.read()).credentials).toEqual({});
		await f.runtime.updateToolSettings({ type: "patch", expected: await f.store.read(), patch: { target: "parents", id: "example", enabled: true } });
		await f.invoke("example_lookup");
		expect(example.request).toHaveBeenCalledWith("example_lookup", "");
		expect((await f.runtime.getToolSettings()).settings?.parents.find(parent => parent.id === "example")?.credential).toBeUndefined();
	});

	it("rejects colliding declarations and undeclared factory tools", async () => {
		const example = examplePlugin();
		const f = await fixture([]);
		await f.runtime.close();
		const collision = { ...example.plugin, inventory: example.plugin.inventory.map(tool => ({ ...tool, name: tool.name === "example_lookup" ? "web_search" : tool.name })) };
		expect(() => validatePlugins([firecrawlPlugin, collision])).toThrow();
		expect(() => validatePlugins([example.plugin, example.plugin])).toThrow();
		const mismatch = { ...example.plugin, create: () => ({ tools: [], abortAll() {}, abortTool() {} }) };
		expect(() => new ToolPolicyRuntime({ plugins: [mismatch], directory: f.store.directory })).toThrow("Plugin tools do not match");
	});

	it("migrates v1 and preserves preferences across plugin removal and reinstallation", async () => {
		const path = await directory();
		const oldInventory = [...BUILTIN_POLICY_INVENTORY, ...firecrawlPlugin.inventory];
		const initial = createPolicyDefaults("existing-profile", oldInventory, [firecrawlPlugin]);
		const reference = "00000000-0000-4000-8000-000000000001";
		const configured = publishPluginCredential(initial, { ...initial, generation: 0 }, reference, true, "firecrawl").snapshot;
		const legacy = patchPolicy(configured, configured, { target: "tools", id: "firecrawl.tool.fetch", enabled: false }).snapshot;
		await writeFile(join(path, "tool-settings.json"), JSON.stringify({ ...legacy, schemaVersion: 1 }));
		const example = examplePlugin();
		const installed = await fixture([firecrawlPlugin, example.plugin], path);
		const migrated = await installed.store.read();
		expect(migrated.schemaVersion).toBe(2);
		expect(migrated.epoch).toBe(legacy.epoch);
		expect(migrated.revision).toBe(legacy.revision + 1);
		expect(migrated.credentials.firecrawl).toEqual(legacy.credentials.firecrawl);
		expect(migrated.tools["firecrawl.tool.fetch"].enabled).toBe(false);
		expect(migrated.parents.example.enabled).toBe(false);
		installed.secrets.get("firecrawl")!.set(reference, "existing-key");
		expect(await installed.credentials.get("firecrawl")!.read(migrated)).toBe("existing-key");
		expect((await installed.store.read()).revision).toBe(migrated.revision);
		expect(JSON.parse(await readFile(join(path, "tool-settings.json"), "utf8")).schemaVersion).toBe(2);
		await installed.save("example", "example-secret");
		const beforeRemoval = await installed.store.read();
		await installed.runtime.close();
		const removed = await fixture([firecrawlPlugin], path);
		expect(await removed.store.read()).toEqual(beforeRemoval);
		expect(removed.pi.getAllTools().map(tool => tool.name)).toEqual(["web_search", "web_fetch"]);
		expect((await removed.runtime.getToolSettings()).settings?.parents.some(parent => parent.id === "example")).toBe(false);
		expect((await removed.save("example", "ignored-secret")).ok).toBe(false);
		expect((await removed.store.update(await removed.store.read(), { target: "parents", id: "example", enabled: false })).ok).toBe(false);
		await removed.runtime.close();
		const restored = await fixture([firecrawlPlugin, example.plugin], path);
		expect(await restored.store.read()).toEqual(beforeRemoval);
		expect((await restored.store.read()).parents.example.enabled).toBe(true);
	});
});
