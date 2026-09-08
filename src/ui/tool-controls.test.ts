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
