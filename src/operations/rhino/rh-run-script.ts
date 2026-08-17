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

		context.reportProgress({
			phase: "rhino_script",
			message: `Running ${input.items.length} Rhino script item(s).`,
			completed: 0,
			total: input.items.length,
		});
		const response = await context.backend.executeActions({
			scope: "rhino",
			actions: input.items.map((item) => ({
				kind: "runRhinoScript",
				input: { mode: item.mode, source: item.source, echo: item.echo ?? false },
			})),
		}, context.signal);
		const envelope = response.data && typeof response.data === "object" && !Array.isArray(response.data)
			? response.data
			: null;
		const actionResults = envelope && Array.isArray(envelope.actions) ? envelope.actions : [];
		const items: RhRunScriptData["items"] = input.items.map((item, index) => {
			const action = actionResults[index];
			const record = action && typeof action === "object" && !Array.isArray(action) ? action : null;
			const payload = record?.data && typeof record.data === "object" && !Array.isArray(record.data)
				? record.data as RunRhinoScriptResponse
				: null;
			const outcome = record?.outcome === "succeeded" || record?.outcome === "failed"
				|| record?.outcome === "unknown" || record?.outcome === "skipped"
				? record.outcome
				: response.outcome === "unknown" ? "unknown" : "skipped";
			return {
				index,
				mode: item.mode,
				outcome,
				output: payload?.output ?? "",
				echoed: item.mode === "command" && item.echo === true,
				error: outcome === "failed" || outcome === "unknown"
					? payload?.error || (record?.message as string | undefined) || response.error?.message || "Rhino script failed."
					: null,
			};
		});
		const base = response.outcome === "succeeded"
			? succeeded(`Completed ${items.length} Rhino script item(s).`, { items })
			: failed(
				response.outcome === "unknown" ? "outcome_unknown"
					: response.outcome === "partial" ? "partial_mutation" : "operation_failed",
				response.error?.message ?? `Rhino script request ${response.outcome}.`,
				{
					outcome: response.outcome === "in_progress" ? "unknown" : response.outcome,
					data: { items },
					retryable: response.outcome === "unknown",
				},
			);
		return { ...base, execution: { canvasDigestAfter: response.canvasDigestAfter ?? null } };
	},
});
