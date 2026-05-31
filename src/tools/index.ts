import { rhRunScriptTool } from "./rh-run-script.js";
import { rhQueryObjectsTool } from "./rh-query-objects.js";
import { ghParamRhinoTool } from "./gh-param-rhino.js";
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

/** All tool definitions in registration order (Rhino doc first, then GH edit/query tools) */
export const ALL_TOOLS = [
	rhRunScriptTool,
	rhQueryObjectsTool,
	// ── Edit tools ──
	ghParamRhinoTool,
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
	rhRunScriptTool,
	rhQueryObjectsTool,
	ghParamRhinoTool,
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
