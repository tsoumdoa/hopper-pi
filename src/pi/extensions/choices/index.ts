import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAskUserTool } from "./register-ask-user.js";
import { registerPickOptionTool } from "./register-pick-option.js";

/**
 * Hopper agent choice tools — thin wrappers over Pi's ctx.ui.* primitives.
 *
 * pick_option (ctx.ui.select), ask_user (ctx.ui.input)
 */
export default function hopperChoicesExtension(pi: ExtensionAPI): void {
	registerPickOptionTool(pi);
	registerAskUserTool(pi);
}
