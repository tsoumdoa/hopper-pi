import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Input, truncateToWidth } from "@earendil-works/pi-tui";
import type { AgentToolsSnapshot, ToolSettingsAction } from "../host/protocol.js";
import type { ToolPolicyRuntime } from "../services/tool-policy-runtime.js";

/** The underlying value is never rendered or passed through the normal command editor. */
export class MaskedCredentialInput extends Input {
	constructor(private readonly submitLabel = "Save key") { super(); }
	override render(width: number): string[] {
		return ["Firecrawl API key", `> ${"*".repeat(Math.min(this.getValue().length, Math.max(0, width - 3)))}`,
			`Enter: ${this.submitLabel}. Escape: cancel.`].map(line => truncateToWidth(line, width));
	}
}

async function readKey(ctx: ExtensionCommandContext, submitLabel: string): Promise<string | undefined> {
	return ctx.ui.custom<string | undefined>((tui, _theme, _keybindings, done) => {
		const input = new MaskedCredentialInput(submitLabel);
		input.focused = true;
		input.onSubmit = value => { input.setValue(""); done(value); };
		input.onEscape = () => { input.setValue(""); done(undefined); };
		return {
			render: width => input.render(width), invalidate: () => input.invalidate(),
			handleInput: data => { input.handleInput(data); tui.requestRender(); },
			dispose: () => input.setValue(""),
		};
	});
}

export function registerToolControlsCommand(pi: ExtensionAPI, runtime: ToolPolicyRuntime): void {
	pi.registerCommand("hopper-tools", {
		description: "Manage Hopper tools, Firecrawl API key, and session activation",
		handler: async (args, ctx) => {
			if (args.trim()) {
				ctx.ui.notify("Run /hopper-tools without arguments. Enter API keys only in the masked setup form.", "warning");
				return;
			}
			if (!ctx.hasUI || ctx.mode !== "tui") {
				ctx.ui.notify("Open Agent tools in the Hopper app, or run /hopper-tools in Pi's interactive terminal.", "info");
				return;
			}
			const apply = async (action: ToolSettingsAction): Promise<AgentToolsSnapshot> => {
				ctx.ui.notify("Saving tool settings...", "info");
				const result = await runtime.updateToolSettings(action);
				ctx.ui.notify(result.ok
					? result.snapshot.tools.some(tool => tool.status === "pending-exposure")
						? "Saved. Exposure applies before the next model response." : "Tool settings updated."
					: result.error ?? "Settings could not be saved. Review the current settings and try again.", result.ok ? "info" : "warning");
				return result.snapshot;
			};
			const saveKey = async (snapshot: AgentToolsSnapshot, enable: boolean): Promise<void> => {
				if (!snapshot.settings?.version) return;
				const label = enable ? "Save key and enable" : "Save key";
				if (!await ctx.ui.confirm(label,
					"Firecrawl receives search queries and requested URLs. Requests may consume credits on your account. The key is stored in your operating system's protected credential store.")) return;
				let key = await readKey(ctx, label);
				if (!key?.trim()) return;
				try { await apply({ type: "credential", expected: snapshot.settings.version, action: enable ? "save-and-enable" : "save", key }); }
				finally { key = undefined; }
			};
			try {
				while (true) {
					const snapshot = await runtime.getToolSettings();
					const settings = snapshot.settings;
					if (!settings?.version) {
						const choice = await ctx.ui.select("Tool settings unavailable", ["Repair settings", "Check connection", "Done"]);
						if (choice === "Repair settings" && await ctx.ui.confirm("Repair settings", "Restore default preferences and require Firecrawl key setup again?")) await apply({ type: "repair" });
						else if (choice === "Check connection") await apply({ type: "check-connection" });
						else return;
						continue;
					}
					const labels = settings.parents.map(parent => `${parent.name}: ${parent.enabled ? "on" : "off"}`);
					const choice = await ctx.ui.select("Hopper tools", [...labels, "Check connection", "Restore defaults", "Done"]);
					if (!choice || choice === "Done") return;
					if (choice === "Check connection") { await apply({ type: "check-connection" }); continue; }
					if (choice === "Restore defaults") {
						if (await ctx.ui.confirm("Restore defaults", "Restore all tool preferences and remove the active Firecrawl key reference? Firecrawl will be disabled.")) await apply({ type: "reset", expected: settings.version });
						continue;
					}
					const parent = settings.parents[labels.indexOf(choice)];
					if (!parent) continue;
					const tools = snapshot.tools.filter(tool => tool.parent === parent.id);
					const toolLabels = tools.map(tool => `${tool.name}: ${tool.enabled ? "on" : "off"} (${tool.status ?? "unavailable"})`);
					const toggle = `${parent.enabled ? "Disable" : "Enable"} ${parent.name}`;
					const action = await ctx.ui.select(parent.name, [toggle,
						...(parent.id === "firecrawl" ? [`Manage API key (${settings.credential})`] : []), ...toolLabels, "Back"]);
					if (action === toggle) {
						if (parent.id === "firecrawl" && !parent.enabled && settings.credential !== "configured") await saveKey(snapshot, true);
						else await apply({ type: "patch", expected: settings.version, patch: { target: "parents", id: parent.id, enabled: !parent.enabled } });
					} else if (action?.startsWith("Manage API key")) {
						const operation = await ctx.ui.select("Firecrawl API key", ["Save replacement", "Remove key / retry removal", "Back"]);
						if (operation === "Save replacement") await saveKey(snapshot, false);
						else if (operation === "Remove key / retry removal") await apply({ type: "credential", expected: settings.version, action: "remove" });
					} else if (action && toolLabels.includes(action)) {
						const tool = tools[toolLabels.indexOf(action)];
						if (!tool.id) continue;
						if (!parent.enabled) { ctx.ui.notify("Enable the parent group before changing its tools. Individual choices are preserved.", "info"); continue; }
						const change = `${tool.enabled ? "Disable" : "Enable"} tool`;
						const operation = await ctx.ui.select(`${tool.name}: ${tool.status}`, [change,
							...(tool.enabled && tool.available && !tool.active ? ["Activate for this session"] : []), "Back"]);
						if (operation === change) await apply({ type: "patch", expected: settings.version, patch: { target: "tools", id: tool.id, enabled: !tool.enabled } });
						else if (operation === "Activate for this session") await apply({ type: "activate", id: tool.id });
					}
				}
			} catch { ctx.ui.notify("Tool settings are unavailable. Reopen /hopper-tools to try again.", "error"); }
		},
	});
}
