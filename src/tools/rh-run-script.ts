import { Type } from "typebox";
import { defineHopperTool as defineTool } from "../core/tool-contract.js";
import { validateRhinoScriptItem } from "../services/rhino-script-validator.js";
import { formatToolFailed } from "./result-formatters.js";
import { runRhinoScript } from "./rhino-script-handlers.js";
import { isAbortError } from "../core/tool-error.js";

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
			{ minItems: 1 },
		),
	}),

	async execute(_toolCallId, params, signal, onUpdate) {
		const results: string[] = [];
		let hasError = false;

		for (const item of params.items) {
			signal?.throwIfAborted();
			const validationError = validateRhinoScriptItem(item);
			if (validationError) {
				hasError = true;
				results.push(formatToolFailed(validationError));
				continue;
			}

			onUpdate?.({
				content: [{ type: "text", text: `Running Rhino ${item.mode} script...` }],
				details: {},
			});

			try {
				results.push(await runRhinoScript(item, signal));
			} catch (err) {
				if (isAbortError(err)) throw err;
				hasError = true;
				results.push(formatToolFailed(err));
			}
		}

		return {
			content: [{ type: "text", text: results.join("\n\n") }],
			details: {},
			...(hasError ? { isError: true } : {}),
		};
	},
});
