import {
	ghGetCanvasTool,
	ghListComponentsTool,
} from "./query-tools.js";

import {
	ghAddComponentTool,
	ghDeleteComponentTool,
	ghConnectWireTool,
	ghDisconnectWireTool,
	ghMoveComponentTool,
	ghRenameComponentTool,
	ghSetLockedTool,
	ghSetHiddenTool,
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
	ghAddComponentTool,
	ghDeleteComponentTool,
	ghConnectWireTool,
	ghDisconnectWireTool,
	ghMoveComponentTool,
	ghRenameComponentTool,
	ghSetLockedTool,
	ghSetHiddenTool,
	ghEditGroupTool,
	ghSetSliderValueTool,
	ghSetPanelTextTool,
] as const;

// Re-export for convenience
export {
	ghGetCanvasTool,
	ghListComponentsTool,
	ghAddComponentTool,
	ghDeleteComponentTool,
	ghConnectWireTool,
	ghDisconnectWireTool,
	ghMoveComponentTool,
	ghRenameComponentTool,
	ghSetLockedTool,
	ghSetHiddenTool,
	ghEditGroupTool,
	ghSetSliderValueTool,
	ghSetPanelTextTool,
};
