import {
	ghGetCanvasTool,
	ghListComponentsTool,
} from "./query-tools.js";

import {
	ghEditComponentsTool,
	ghConnectWireTool,
	ghDisconnectWireTool,
	ghEditGroupTool,
	ghSetSliderValueTool,
	ghSetPanelTextTool,
} from "./edit-tools.js";

/** All tool definitions in registration order (query tools first, then edit tools) */
export const ALL_TOOLS = [
	// ── Query tools ──
	ghGetCanvasTool,
	ghListComponentsTool,
	// ── Edit tools ──
	ghEditComponentsTool,
	ghConnectWireTool,
	ghDisconnectWireTool,
	ghEditGroupTool,
	ghSetSliderValueTool,
	ghSetPanelTextTool,
] as const;

// Re-export for convenience
export {
	ghGetCanvasTool,
	ghListComponentsTool,
	ghEditComponentsTool,
	ghConnectWireTool,
	ghDisconnectWireTool,
	ghEditGroupTool,
	ghSetSliderValueTool,
	ghSetPanelTextTool,
};
