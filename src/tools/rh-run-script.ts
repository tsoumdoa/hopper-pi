import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { validateRhinoScriptItem } from "../services/rhino-script-validator.js";
import { formatToolFailed } from "./result-formatters.js";
import { runRhinoScript } from "./rhino-script-handlers.js";

const ROUTING_PREFIX =
	"USE rh_run_script for Rhino document / viewport work (geometry, layers, selection, blocks, bake, materials). " +
	"USE rh_query_objects to list Rhino object GUIDs for gh_param_rhino. " +
	"USE gh_* tools for Grasshopper canvas (components, wires, sliders, GH script nodes). ";

export const rhRunScriptTool = defineTool({
	name: "rh_run_script",
	label: "Run Rhino Script",
	description:
		ROUTING_PREFIX +
		"Runs Rhino command macros or Python/C# scripts on the active RhinoDoc (Rhino 8 RhinoCode). " +
		"Prefer mode=python for multi-step geometry; mode=command for one-liners (_Circle, _SelLayer). " +
		"For script modes, use print() in Python and Console.WriteLine() in C# so stdout is returned to the agent. " +
		"Changes group into one Rhino Undo step per agent turn when the extension lifecycle hooks run.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Object({
				mode: Type.Union([
					Type.Literal("command"),
					Type.Literal("python"),
					Type.Literal("csharp"),
				], {
					description:
						"command = Rhino macro string; python = Rhino Python (scriptcontext/rs); csharp = Rhino C# script editor body",
				}),
				source: Type.String({ description: "Command macro or script source" }),
				echo: Type.Optional(
					Type.Boolean({
						description: "Echo command to history (command mode only, default false)",
					}),
				),
			}),
		),
	}),

	async execute(_toolCallId, params, _signal, onUpdate) {
		const results: string[] = [];

		for (const item of params.items) {
			const validationError = validateRhinoScriptItem(item);
			if (validationError) {
				results.push(formatToolFailed(validationError));
				continue;
			}

			onUpdate?.({
				content: [{ type: "text", text: `Running Rhino ${item.mode} script...` }],
				details: {},
			});

			try {
				results.push(await runRhinoScript(item));
			} catch (err) {
				results.push(formatToolFailed(err));
			}
		}

		return {
			content: [{ type: "text", text: results.join("\n\n") }],
			details: {},
		};
	},
});
