import {
	ghGetCanvasTool,
	ghListComponentsTool,
	ghGetCanvasErrorsTool,
} from "./query-tools.js";

import {
	ghEditComponentsTool,
	ghEditParamTool,
	ghEditWireTool,
	ghEditGroupTool,
	ghEditSliderTool,
	ghEditPanelTool,
	ghEditToggleTool,
	ghEditSwatchTool,
	ghEditScribbleTool,
	ghEditValueListTool,
	ghEditScriptTool,
} from "./edit-tools.js";

/** All tool definitions in registration order (query tools first, then edit tools) */
export const ALL_TOOLS = [
	// ── Query tools ──
	ghGetCanvasTool,
	ghListComponentsTool,
	ghGetCanvasErrorsTool,
	// ── Edit tools ──
	ghEditComponentsTool,
	ghEditParamTool,
	ghEditWireTool,
	ghEditGroupTool,
	ghEditSliderTool,
	ghEditPanelTool,
	ghEditToggleTool,
	ghEditSwatchTool,
	ghEditScribbleTool,
	ghEditValueListTool,
	ghEditScriptTool,
] as const;

// Re-export for convenience
export {
	ghGetCanvasTool,
	ghListComponentsTool,
	ghGetCanvasErrorsTool,
	ghEditComponentsTool,
	ghEditParamTool,
	ghEditWireTool,
	ghEditGroupTool,
	ghEditSliderTool,
	ghEditPanelTool,
	ghEditToggleTool,
	ghEditSwatchTool,
	ghEditScribbleTool,
	ghEditValueListTool,
	ghEditScriptTool,
};
