import { defineTool } from "@earendil-works/pi-coding-agent";
import { RhRunScriptInputSchema } from "../core/schemas.js";
import { formatCoreFailure, operationDetails, operationSignal, prototypeOperation } from "./core-adapter.js";

const runScriptOperation = prototypeOperation("rh_run_script");

const ROUTING_PREFIX =
	"Use rh_run_script for Rhino document work (geometry, layers, selection, blocks, direct bake, materials). " +
	"Use rh_view_control for normal viewport/camera changes, rh_query_objects for object IDs, and gh_* tools for the Grasshopper canvas. ";

export const rhRunScriptTool = defineTool({
	name: "rh_run_script",
	label: "Run Rhino Script",
	description:
		ROUTING_PREFIX +
		"Runs Rhino command macros or Python/C# scripts on the active RhinoDoc (Rhino 8 RhinoCode). " +
		"Prefer Python for multi-step work and command mode for one-liners. Use print() / Console.WriteLine() for returned output. " +
		"Items run sequentially; a failure does not roll back earlier items. Changes share one Rhino Undo record per agent turn.",
	promptSnippet: "Run command, Python, or C# against the active Rhino document",
	parameters: RhRunScriptInputSchema,

	async execute(_toolCallId, params, _signal, onUpdate) {
		onUpdate?.({ content: [{ type: "text", text: "Running Rhino script items..." }], details: {} });
		const result = await runScriptOperation.execute(params, operationSignal(_signal));
		if (result.outcome !== "succeeded") {
			return { content: [{ type: "text", text: formatCoreFailure(result) }], details: operationDetails(result) };
		}
		const data = result.data as { items: Array<{ mode: string; ok: boolean; output: string; error: string | null }> };
		const text = data.items.map((item) => [
			`${item.ok ? "OK" : "FAILED"} (mode=${item.mode})`,
			item.error,
			item.output,
		].filter(Boolean).join("\n")).join("\n\n");
		return {
			content: [{ type: "text", text }],
			details: operationDetails(result),
		};
	},
});
