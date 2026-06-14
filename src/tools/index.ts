import { rhRunScriptTool } from "./rh-run-script.js";
import { rhQueryObjectsTool } from "./rh-query-objects.js";
import { ghParamRhinoTool } from "./gh-param-rhino.js";
import {
	ghGetCanvasTool,
	ghListComponentsTool,
	ghGetCanvasErrorsTool,
} from "./query-tools.js";
import { ghEditComponentsTool } from "./edit-tools/gh-edit-components.js";
import { ghEditParamTool } from "./edit-tools/gh-edit-param.js";
import { ghEditWireTool } from "./edit-tools/gh-edit-wire.js";
import { ghEditGroupTool } from "./edit-tools/gh-edit-group.js";
import { ghCreateWidgetTool } from "./edit-tools/gh-create-widget.js";
import { ghMutateWidgetTool } from "./edit-tools/gh-mutate-widget.js";
import { ghEditScriptTool } from "./edit-tools/gh-edit-script.js";

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
