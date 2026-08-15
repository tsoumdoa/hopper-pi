import { ghApplyGraphTool } from "../tools/gh-apply-graph.js";
import { ghParamRhinoTool } from "../tools/gh-param-rhino.js";
import { ghCreateWidgetTool } from "../tools/edit-tools/gh-create-widget.js";
import { ghEditComponentsTool } from "../tools/edit-tools/gh-edit-components.js";
import { ghEditGroupTool } from "../tools/edit-tools/gh-edit-group.js";
import { ghEditParamTool } from "../tools/edit-tools/gh-edit-param.js";
import { ghEditScriptTool } from "../tools/edit-tools/gh-edit-script.js";
import { ghEditWireTool } from "../tools/edit-tools/gh-edit-wire.js";
import { ghMutateWidgetTool } from "../tools/edit-tools/gh-mutate-widget.js";
import { ghGetCanvasErrorsTool, ghGetCanvasTool, ghListComponentsTool } from "../tools/query-tools.js";
import { rhCaptureViewTool } from "../tools/rh-capture-view.js";
import { rhQueryObjectsTool } from "../tools/rh-query-objects.js";
import { rhRunScriptTool } from "../tools/rh-run-script.js";
import { rhViewControlTool } from "../tools/rh-view-control.js";

/** Stable, framework-neutral server catalog. Pi-only interaction tools are excluded. */
export const HOPPER_TOOLS = [
	rhRunScriptTool,
	rhQueryObjectsTool,
	rhViewControlTool,
	ghApplyGraphTool,
	ghParamRhinoTool,
	ghCreateWidgetTool,
	ghMutateWidgetTool,
	ghEditComponentsTool,
	ghEditParamTool,
	ghEditWireTool,
	ghEditGroupTool,
	ghEditScriptTool,
	ghGetCanvasTool,
	ghListComponentsTool,
	ghGetCanvasErrorsTool,
	rhCaptureViewTool,
] as const;

export type HopperToolName = (typeof HOPPER_TOOLS)[number]["name"];
