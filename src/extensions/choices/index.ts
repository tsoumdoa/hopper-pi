import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerAskUserTool } from "./register-ask-user.js";
import { registerPickOptionTool } from "./register-pick-option.js";
import { toolPolicyForSession } from "../../services/tool-policy-runtime.js";

/** Register after the main Hopper policy has bound the current session. */
export default function hopperChoicesExtension(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		const policy = toolPolicyForSession(ctx.sessionManager.getSessionId());
		if (!policy) { ctx.ui.notify("Hopper tool settings are unavailable; choice tools were not loaded.", "error"); return; }
		const guarded = Object.create(pi) as ExtensionAPI;
		guarded.registerTool = tool => { policy.register(pi, tool as unknown as ToolDefinition); };
		registerPickOptionTool(guarded);
		registerAskUserTool(guarded);
		await policy.reconcile();
	});
}
