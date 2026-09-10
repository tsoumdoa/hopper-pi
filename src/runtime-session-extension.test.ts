import { expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createHopperPiExtension, type HopperExtensionOptions } from "./index.js";
import { RuntimeSessionContext } from "./infra/runtime-session-context.js";
import { getRuntimeRpc, type RuntimeRpc } from "./infra/runtime-rpc.js";

function extension(id: string, runTool?: HopperExtensionOptions["runTool"]) {
	const runtime = {
		beginAgentTurn: vi.fn(), commitAgentTurn: vi.fn(async () => {}), cancelAgentTurn: vi.fn(async () => {}),
		getRuntimeStatus: vi.fn(async () => ({})),
		connect: vi.fn(async () => {}),
		request: vi.fn(async () => ({ ok: false })),
	};
	const session = new RuntimeSessionContext({ createRuntime: () => runtime as unknown as RuntimeRpc });
	const hooks = new Map<string, Array<(...args: any[]) => unknown>>();
	const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
	const commands = new Map<string, Parameters<ExtensionAPI["registerCommand"]>[1]>();
	const pi = {
		on(name: string, handler: (...args: any[]) => unknown) { hooks.set(name, [...hooks.get(name) ?? [], handler]); },
		registerTool(tool: Parameters<ExtensionAPI["registerTool"]>[0]) { tools.set(tool.name, tool); },
		registerCommand(name: string, command: Parameters<ExtensionAPI["registerCommand"]>[1]) { commands.set(name, command); },
		registerFlag() {}, getFlag: () => false, getAllTools: () => [...tools.values()],
		getActiveTools: () => [...tools.keys()], setActiveTools() {},
	};
	createHopperPiExtension({ runtimeSession: session, sessionId: () => id, runTool })(pi as unknown as ExtensionAPI);
	return { runtime, session, tools, commands, async emit(name: string, event = {}) {
		for (const hook of hooks.get(name) ?? []) await hook(event, { hasUI: false });
	} };
}

it("binds independently registered Pi turn hooks and tools to their injected sessions", async () => {
	const a = extension("a"), b = extension("b");
	a.session.run(getRuntimeRpc);
	b.session.run(getRuntimeRpc);
	await a.emit("agent_start");
	await b.emit("agent_start");
	await a.emit("agent_end", { willRetry: true });
	expect(a.runtime.commitAgentTurn).not.toHaveBeenCalled();
	await a.emit("agent_end");
	await b.emit("session_shutdown");
	expect(a.runtime.beginAgentTurn).toHaveBeenCalledTimes(1);
	expect(a.runtime.commitAgentTurn).toHaveBeenCalledTimes(1);
	expect(a.runtime.cancelAgentTurn).not.toHaveBeenCalled();
	expect(b.runtime.beginAgentTurn).toHaveBeenCalledTimes(1);
	expect(b.runtime.commitAgentTurn).not.toHaveBeenCalled();
	expect(b.runtime.cancelAgentTurn).toHaveBeenCalledTimes(1);
	// Capture tools register after extension setup when an image-capable model is selected.
	await a.emit("model_select", { model: { provider: "test", id: "vision", input: ["text", "image"] } });
	const capture = a.tools.get("rh_capture_view")!;
	expect(capture).toBeDefined();
	await capture.execute("capture", {}, undefined, undefined, { model: { input: ["text", "image"] } } as never);
	expect(a.runtime.request).toHaveBeenCalledWith("captureRhinoView", expect.anything());
	expect(b.runtime.request).not.toHaveBeenCalled();
});

it("wraps dynamically registered native tools inside the lease and preserves their session context", async () => {
	const trace: string[] = [];
	const a = extension("a", async (name, work) => {
		trace.push(`acquire:${name}`);
		try { return await work(); }
		finally { trace.push(`release:${name}`); }
	});
	a.runtime.request.mockImplementation(async () => { trace.push("native:a"); return { ok: false }; });
	await a.emit("model_select", { model: { provider: "test", id: "vision", input: ["text", "image"] } });
	await a.tools.get("rh_capture_view")!.execute("capture", {}, undefined, undefined, { model: { input: ["text", "image"] } } as never);
	expect(trace).toEqual(["acquire:rh_capture_view", "native:a", "release:rh_capture_view"]);
});
