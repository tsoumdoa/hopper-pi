import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ToolPolicyRuntime } from "../services/tool-policy-runtime.js";
import { MaskedCredentialInput, registerToolControlsCommand } from "./tool-controls.js";

describe("external tool controls", () => {
	it("never renders entered or pasted secret text", () => {
		const input = new MaskedCredentialInput();
		input.handleInput("sentinel-secret");
		input.handleInput("\x1b[200~pasted-secret\x1b[201~");
		expect(input.getValue()).toContain("secret");
		for (const width of [2, 10, 80]) {
			const rendered = input.render(width).join("\n");
			expect(rendered).not.toContain("sentinel");
			expect(rendered).not.toContain("pasted");
		}
	});
	it("rejects command arguments and does not open secret entry in RPC mode", async () => {
		let handler!: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
		const pi = { registerCommand: (_name: string, command: { handler: typeof handler }) => { handler = command.handler; } };
		const runtime = { getToolSettings: vi.fn() };
		registerToolControlsCommand(pi as unknown as ExtensionAPI, runtime as unknown as ToolPolicyRuntime);
		const notify = vi.fn();
		const ctx = { hasUI: true, mode: "rpc", ui: { notify, custom: vi.fn() } } as unknown as ExtensionCommandContext;
		await handler("sentinel-secret", ctx);
		await handler("", ctx);
		expect(JSON.stringify(notify.mock.calls)).not.toContain("sentinel-secret");
		expect(ctx.ui.custom).not.toHaveBeenCalled();
		expect(runtime.getToolSettings).not.toHaveBeenCalled();
	});
});

it("uses plugin metadata for terminal setup and sends the plugin ID", async () => {
	let handler!: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
	const pi = { registerCommand: (_name: string, command: { handler: typeof handler }) => { handler = command.handler; } };
	const snapshot = { tools: [], settings: { version: { epoch: "profile", revision: 0 }, parents: [
		{ id: "example", name: "Example", enabled: false, credential: { label: "Example API key", notice: "Requests go to Example.", status: "missing" } },
	] } };
	const runtime = { getToolSettings: vi.fn(async () => snapshot), updateToolSettings: vi.fn(async () => ({ ok: true, snapshot })) };
	registerToolControlsCommand(pi as unknown as ExtensionAPI, runtime as unknown as ToolPolicyRuntime);
	const select = vi.fn().mockResolvedValueOnce("Example: off").mockResolvedValueOnce("Manage API key (missing)").mockResolvedValueOnce("Save replacement").mockResolvedValueOnce("Done");
	const confirm = vi.fn(async () => true);
	const custom = vi.fn(async (create: Function) => new Promise(resolve => {
		const ui = create({ requestRender() {} }, undefined, undefined, resolve);
		ui.handleInput("example-secret");
		expect(ui.render(80).join("\n")).toContain("Example API key");
		expect(ui.render(80).join("\n")).not.toContain("example-secret");
		ui.handleInput("\r");
	}));
	const ctx = { hasUI: true, mode: "tui", ui: { notify: vi.fn(), select, confirm, custom } } as unknown as ExtensionCommandContext;
	await handler("", ctx);
	expect(confirm).toHaveBeenCalledWith("Save key", expect.stringContaining("Requests go to Example."));
	expect(runtime.updateToolSettings).toHaveBeenCalledWith({ type: "credential", pluginId: "example", expected: snapshot.settings.version, action: "save", key: "example-secret" });
});


it("enables a mixed plugin without opening key setup", async () => {
	let handler!: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
	const pi = { registerCommand: (_name: string, command: { handler: typeof handler }) => { handler = command.handler; } };
	const snapshot = { tools: [
		{ id: "example.tool.help", name: "example_help", parent: "example", enabled: true },
		{ id: "example.tool.lookup", name: "example_lookup", parent: "example", enabled: true },
	], settings: { version: { epoch: "profile", revision: 0 }, parents: [
		{ id: "example", name: "Example", enabled: false, credential: { label: "Example API key", notice: "Requests go to Example.", status: "missing" } },
	] } };
	const runtime = { getToolSettings: vi.fn(async () => snapshot), updateToolSettings: vi.fn(async () => ({ ok: true, snapshot })) };
	registerToolControlsCommand(pi as unknown as ExtensionAPI, runtime as unknown as ToolPolicyRuntime);
	const select = vi.fn().mockResolvedValueOnce("Example: off").mockResolvedValueOnce("Enable Example").mockResolvedValueOnce("Done");
	const confirm = vi.fn();
	const custom = vi.fn();
	const ctx = { hasUI: true, mode: "tui", ui: { notify: vi.fn(), select, confirm, custom } } as unknown as ExtensionCommandContext;
	await handler("", ctx);
	expect(confirm).not.toHaveBeenCalled();
	expect(custom).not.toHaveBeenCalled();
	expect(runtime.updateToolSettings).toHaveBeenCalledExactlyOnceWith({ type: "patch", expected: snapshot.settings.version, patch: { target: "parents", id: "example", enabled: true } });
});


it.each(["toggle", "remove-key"])("targets the selected plugin when display names collide: %s", async action => {
	let handler!: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
	const pi = { registerCommand: (_name: string, command: { handler: typeof handler }) => { handler = command.handler; } };
	const snapshot = { tools: [], settings: { version: { epoch: "profile", revision: 0 }, parents: ["first", "second"].map(id => ({
		id, name: "Example", enabled: false, credential: { label: `${id} API key`, notice: "", status: "missing" },
	})) } };
	const runtime = { getToolSettings: vi.fn(async () => snapshot), updateToolSettings: vi.fn(async () => ({ ok: true, snapshot })) };
	registerToolControlsCommand(pi as unknown as ExtensionAPI, runtime as unknown as ToolPolicyRuntime);
	const select = vi.fn().mockResolvedValueOnce("Example [second]: off");
	if (action === "toggle") select.mockResolvedValueOnce("Enable Example");
	else select.mockResolvedValueOnce("Manage API key (missing)").mockResolvedValueOnce("Remove key / retry removal");
	select.mockResolvedValueOnce("Done");
	const ctx = { hasUI: true, mode: "tui", ui: { notify: vi.fn(), select } } as unknown as ExtensionCommandContext;
	await handler("", ctx);
	expect(select).toHaveBeenNthCalledWith(1, "Hopper tools", expect.arrayContaining(["Example [first]: off", "Example [second]: off"]));
	expect(runtime.updateToolSettings).toHaveBeenCalledExactlyOnceWith(action === "toggle"
		? { type: "patch", expected: snapshot.settings.version, patch: { target: "parents", id: "second", enabled: true } }
		: { type: "credential", pluginId: "second", expected: snapshot.settings.version, action: "remove" });
});
