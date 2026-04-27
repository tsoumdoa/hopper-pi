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
	ghCreateWidgetTool,
	ghMutateWidgetTool,
	ghEditScriptTool,
} from "./edit-tools/index.js";

/** All tool definitions in registration order (query tools first, then edit tools) */
export const ALL_TOOLS = [
	// ── Edit tools ──
	ghCreateWidgetTool,
	ghMutateWidgetTool,
	ghEditComponentsTool,
	ghEditParamTool,
	ghEditWireTool,
	ghEditGroupTool,
	ghEditScriptTool,
	// ── Query tools ──
	ghGetCanvasTool,
	ghListComponentsTool,
	ghGetCanvasErrorsTool,
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
	ghCreateWidgetTool,
	ghMutateWidgetTool,
	ghEditScriptTool,
};
