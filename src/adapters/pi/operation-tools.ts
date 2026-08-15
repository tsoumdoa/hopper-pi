import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { JsonValue } from "../../core/contracts.js";
import type { HopperOperation, OperationContext } from "../../core/operations.js";
import { HOPPER_OPERATIONS } from "../../operations/index.js";
import {
	createPiToolDefinition,
	type PiOperationContextFactoryArgs,
} from "./operation-adapter.js";
import { createLegacyPiOperationContext } from "./legacy-context.js";

type ContextFactory = (
	args: PiOperationContextFactoryArgs,
) => OperationContext | Promise<OperationContext>;

type ToolPresentation = {
	label: string;
	promptSnippet?: string;
	promptGuidelines?: string[];
};

const PRESENTATION: Record<string, ToolPresentation> = {
	rh_run_script: {
		label: "Run Rhino Script",
		promptSnippet: "Run command, Python, or C# against the active Rhino document",
	},
	rh_query_objects: {
		label: "Query Rhino Objects",
		promptSnippet: "List or count filtered Rhino document objects and return short IDs",
	},
	rh_view_control: { label: "Control Rhino View" },
	rh_capture_view: {
		label: "Capture Rhino View",
		promptSnippet: "Capture a consent-gated Rhino viewport screenshot for visual QA",
		promptGuidelines: [
			"Use rh_capture_view only when pixels materially help visual QA and Rhino screenshot consent is allowed.",
			"If rh_capture_view is unavailable or denied, continue with text and geometry tools instead of blocking the task.",
		],
	},
	gh_param_rhino: { label: "Param Rhino Geometry" },
	gh_get_canvas: {
		label: "Get Canvas",
		promptSnippet: "Inspect Grasshopper canvas structure, selection, IDs, ports, and wires",
	},
	gh_list_components: { label: "List Components" },
	gh_get_canvas_errors: {
		label: "Get Canvas Errors",
		promptSnippet: "Validate Grasshopper runtime messages and detect component overlaps",
	},
	gh_apply_graph: { label: "Apply Graph" },
	gh_create_widget: { label: "Create Widget" },
	gh_mutate_widget: { label: "Mutate Widget" },
	gh_edit_components: { label: "Edit Components" },
	gh_edit_param: { label: "Edit Script Ports" },
	gh_edit_wire: { label: "Edit Wire" },
	gh_edit_group: { label: "Edit Group" },
	gh_edit_script: { label: "Edit Script" },
};

function adaptOperation(
	operation: HopperOperation<JsonValue, JsonValue>,
	createContext: ContextFactory,
): ToolDefinition {
	const presentation = PRESENTATION[operation.name];
	if (!presentation) throw new Error(`Missing Pi presentation metadata for ${operation.name}.`);
	return {
		...createPiToolDefinition(operation, {
			label: presentation.label,
			createContext,
		}),
		...(presentation.promptSnippet ? { promptSnippet: presentation.promptSnippet } : {}),
		...(presentation.promptGuidelines ? { promptGuidelines: presentation.promptGuidelines } : {}),
	};
}

export function createPiOperationTools(
	createContext: ContextFactory = createLegacyPiOperationContext,
): Readonly<Record<string, ToolDefinition>> {
	return Object.fromEntries(HOPPER_OPERATIONS.map((operation) => [
		operation.name,
		adaptOperation(
			operation as unknown as HopperOperation<JsonValue, JsonValue>,
			createContext,
		),
	]));
}

export const HOPPER_PI_OPERATION_TOOLS = createPiOperationTools();

function tool(name: string): ToolDefinition {
	const definition = HOPPER_PI_OPERATION_TOOLS[name];
	if (!definition) throw new Error(`Missing Pi operation adapter for ${name}.`);
	return definition;
}

export const rhRunScriptTool = tool("rh_run_script");
export const rhQueryObjectsTool = tool("rh_query_objects");
export const rhViewControlTool = tool("rh_view_control");
export const rhCaptureViewTool = tool("rh_capture_view");
export const ghParamRhinoTool = tool("gh_param_rhino");
export const ghGetCanvasTool = tool("gh_get_canvas");
export const ghListComponentsTool = tool("gh_list_components");
export const ghGetCanvasErrorsTool = tool("gh_get_canvas_errors");
export const ghApplyGraphTool = tool("gh_apply_graph");
export const ghCreateWidgetTool = tool("gh_create_widget");
export const ghMutateWidgetTool = tool("gh_mutate_widget");
export const ghEditComponentsTool = tool("gh_edit_components");
export const ghEditParamTool = tool("gh_edit_param");
export const ghEditWireTool = tool("gh_edit_wire");
export const ghEditGroupTool = tool("gh_edit_group");
export const ghEditScriptTool = tool("gh_edit_script");
