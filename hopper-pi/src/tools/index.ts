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
	// ── Query tools ──
	ghGetCanvasTool,
	ghListComponentsTool,
	ghGetCanvasErrorsTool,
	// ── Edit tools ──
	ghEditComponentsTool,
	ghEditParamTool,
	ghEditWireTool,
	ghEditGroupTool,
	ghCreateWidgetTool,
	ghMutateWidgetTool,
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
	ghCreateWidgetTool,
	ghMutateWidgetTool,
	ghEditScriptTool,
};
