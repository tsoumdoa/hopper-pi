import { createHash } from "node:crypto";
import { Type, type Static } from "@sinclair/typebox";
import { defineOperation } from "../../core/operations.js";
import { lineCount } from "../../lib/line-count.js";
import { validateRhinoScriptItem } from "../../services/rhino-script-validator.js";
import { preservePiSchemaJson } from "../edit/shared.js";
import { failed, succeeded } from "./shared.js";

export const RhRunScriptInputSchema = preservePiSchemaJson(Type.Object({
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
			echo: Type.Optional(Type.Boolean({
				description: "Echo command to history (command mode only, default false)",
			})),
		}),
		{ minItems: 1 },
	),
}));

const RhRunScriptItemResultSchema = Type.Object({
	index: Type.Integer({ minimum: 0 }),
	mode: Type.Union([
		Type.Literal("command"),
		Type.Literal("python"),
		Type.Literal("csharp"),
	]),
	outcome: Type.Union([
		Type.Literal("succeeded"),
		Type.Literal("failed"),
		Type.Literal("unknown"),
		Type.Literal("skipped"),
	]),
	output: Type.String(),
	echoed: Type.Boolean(),
	error: Type.Union([Type.String(), Type.Null()]),
});

export const RhRunScriptOutputSchema = Type.Object({
	items: Type.Array(RhRunScriptItemResultSchema),
});

export type RhRunScriptInput = Static<typeof RhRunScriptInputSchema>;
export type RhRunScriptData = Static<typeof RhRunScriptOutputSchema>;

type RunRhinoScriptResponse = {
	type: "runRhinoScript.response";
	timestamp: number;
	ok: boolean;
	output: string;
	error: string;
};

export const rhRunScriptOperation = defineOperation<RhRunScriptInput, RhRunScriptData>({
	name: "rh_run_script",
	version: 1,
	description:
		"Run Rhino command macros or Python/C# scripts against the active Rhino document.",
	group: "rhino",
	possibleScopes: ["rhino"],
	inputSchema: RhRunScriptInputSchema,
	outputSchema: RhRunScriptOutputSchema,
	classifyScope: () => "rhino",
	summarizeInput: (input) => ({
		items: input.items.map((item) => ({
			mode: item.mode,
			sha256: createHash("sha256").update(item.source, "utf8").digest("hex"),
			byteLength: Buffer.byteLength(item.source, "utf8"),
			lineCount: lineCount(item.source),
		})),
	}),
	async execute(input, context) {
		const validationErrors = input.items
			.map((item, index) => ({ index, message: validateRhinoScriptItem(item) }))
			.filter((entry): entry is { index: number; message: string } => entry.message !== null);
		if (validationErrors.length > 0) {
			return failed("invalid_input", "One or more Rhino scripts failed validation.", {
				details: {
					issues: validationErrors.map((entry) => ({
						path: `/items/${entry.index}/source`,
						message: entry.message,
					})),
				},
			});
		}

		const items: RhRunScriptData["items"] = [];
		for (const [index, item] of input.items.entries()) {
			context.reportProgress({
				phase: "rhino_script",
				message: `Running Rhino ${item.mode} script.`,
				completed: index,
				total: input.items.length,
			});
			try {
				const response = await context.backend.query<RunRhinoScriptResponse>({
					type: "runRhinoScript",
					mode: item.mode,
					source: item.source,
					echo: item.echo ?? false,
				}, context.signal);
				items.push({
					index,
					mode: item.mode,
					outcome: response.ok ? "succeeded" : "failed",
					output: response.output ?? "",
					echoed: item.mode === "command" && item.echo === true,
					error: response.ok ? null : response.error || "Rhino script failed.",
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				items.push({
					index,
					mode: item.mode,
					outcome: "unknown",
					output: "",
					echoed: item.mode === "command" && item.echo === true,
					error: message,
				});
				for (let skippedIndex = index + 1; skippedIndex < input.items.length; skippedIndex++) {
					const skipped = input.items[skippedIndex]!;
					items.push({
						index: skippedIndex,
						mode: skipped.mode,
						outcome: "skipped",
						output: "",
						echoed: false,
						error: null,
					});
				}
				return failed("outcome_unknown", message, {
					outcome: "unknown",
					data: { items },
					retryable: true,
				});
			}
		}
		const failures = items.filter((item) => item.outcome === "failed");
		if (failures.length > 0) {
			const hasSuccess = failures.length < items.length;
			return failed(hasSuccess ? "partial_mutation" : "operation_failed", failures[0]!.error!, {
				outcome: hasSuccess ? "partial" : "failed",
				data: { items },
			});
		}
		return succeeded(`Completed ${items.length} Rhino script item(s).`, { items });
	},
});
