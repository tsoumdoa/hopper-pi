import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { validateRhinoScriptItem } from "../services/rhino-script-validator.js";
import { formatToolFailed } from "./result-formatters.js";
import { runRhinoScript } from "./rhino-script-handlers.js";

export const rhRunScriptTool = defineTool({
	name: "rh_run_script",
	label: "Run Rhino Script",
	description:
		"Run sequential command, Python, or C# items against the active Rhino document; failures do not roll back earlier items.",
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
				source: Type.String(),
				echo: Type.Optional(
					Type.Boolean({
						description: "Echo command to history (command mode only, default false)",
					}),
				),
			}),
			{ minItems: 1 },
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
