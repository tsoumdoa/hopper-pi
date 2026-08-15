import { fromJsonSchema, type McpServer } from "@modelcontextprotocol/server";
import { Type } from "typebox";

const BuildGraphArgs = Type.Object({
	objective: Type.String({ minLength: 1 }),
	constraints: Type.Optional(Type.String()),
	useExistingCanvas: Type.Optional(Type.Boolean()),
});

const RepairCanvasArgs = Type.Object({
	focus: Type.Optional(Type.String()),
	scope: Type.Optional(Type.Union([
		Type.Literal("canvas"),
		Type.Literal("selection"),
		Type.Literal("subgraph"),
	])),
	subgraph: Type.Optional(Type.String()),
});

const ModelRhinoArgs = Type.Object({
	objective: Type.String({ minLength: 1 }),
	units: Type.Optional(Type.String()),
	visualQa: Type.Optional(Type.Boolean()),
});

function userPrompt(text: string) {
	return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
}

export function registerHopperPrompts(server: McpServer): void {
	server.registerPrompt(
		"build_grasshopper_graph",
		{
			title: "Build a Grasshopper graph",
			description: "Plan, build, and validate a Grasshopper definition.",
			argsSchema: fromJsonSchema(BuildGraphArgs as unknown as Record<string, unknown>),
		},
		(rawArgs) => {
			const args = rawArgs as { objective: string; constraints?: string; useExistingCanvas?: boolean };
			return userPrompt([
			`Build this Grasshopper graph: ${args.objective}`,
			args.constraints ? `Constraints: ${args.constraints}` : "",
			args.useExistingCanvas
				? "Read hopper://grasshopper/canvas first and preserve unrelated existing objects."
				: "Do not read a blank canvas just to recover IDs; gh_apply_graph returns local-ref mappings.",
			"Resolve only unusual or ambiguous component types, then use one gh_apply_graph call and inspect its integrated validation. Repair small failures surgically.",
			"References: hopper://reference/gh-modeling-expert, hopper://reference/apply-graph, hopper://reference/layout-system.",
			].filter(Boolean).join("\n"));
		},
	);

	server.registerPrompt(
		"inspect_and_repair_canvas",
		{
			title: "Inspect and repair a Grasshopper canvas",
			description: "Inspect a canvas or subgraph, diagnose faults, and make a scoped repair.",
			argsSchema: fromJsonSchema(RepairCanvasArgs as unknown as Record<string, unknown>),
		},
		(rawArgs) => {
			const args = rawArgs as { focus?: string; scope?: "canvas" | "selection" | "subgraph"; subgraph?: string };
			if (args.scope === "subgraph" && !args.subgraph) {
				throw new Error("subgraph is required when scope is subgraph");
			}
			const target = args.scope === "subgraph"
				? `hopper://grasshopper/subgraphs/${args.subgraph}`
				: "hopper://grasshopper/canvas";
			return userPrompt([
				`Inspect ${target}${args.focus ? ` with this focus: ${args.focus}` : ""}.`,
				args.scope === "selection" ? "Use gh_get_canvas with selectionOnly=true for the user's current selection." : "",
				"Call gh_get_canvas_errors, explain the fault before mutation, preserve unrelated objects, use existing short IDs, and validate touched objects after repair.",
				"References: hopper://reference/canvas-navigation and hopper://reference/data-type-guide.",
			].filter(Boolean).join("\n"));
		},
	);

	server.registerPrompt(
		"model_in_rhino",
		{
			title: "Model directly in Rhino",
			description: "Create or modify geometry and document state in Rhino.",
			argsSchema: fromJsonSchema(ModelRhinoArgs as unknown as Record<string, unknown>),
		},
		(rawArgs) => {
			const args = rawArgs as { objective: string; units?: string; visualQa?: boolean };
			return userPrompt([
			`Model this directly in Rhino: ${args.objective}`,
			`Units: ${args.units || "mm"}.`,
			"Use rh_run_script for RhinoDoc geometry, layers, materials, and direct bake; rh_view_control for camera or CPlane work; and rh_query_objects for IDs.",
			args.visualQa
				? "Use rh_capture_view for visual QA only if image support and explicit capture consent are available."
				: "Do not require viewport capture.",
			"Use Grasshopper tools only if the requested result is a reusable parametric definition.",
			"References: hopper://reference/rhino-document and hopper://reference/rhino-script-boilerplate.",
			].join("\n"));
		},
	);
}
