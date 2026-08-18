import { defineTool } from "@earendil-works/pi-coding-agent";
import { formatApplyGraphResult } from "../services/gh-apply-graph.js";
import type { ApplyGraphInput } from "../types/gh-apply-graph.js";
import type { OperationFailure } from "../core/contracts.js";
import { GhApplyGraphInputSchema } from "../core/schemas.js";
import { formatCoreFailure, operationDetails, operationSignal, prototypeOperation } from "./core-adapter.js";

const applyGraphOperation = prototypeOperation("gh_apply_graph");

export function formatApplyGraphFailure(result: OperationFailure): string {
	if (result.outcome === "unknown") return formatCoreFailure(result);
	if (result.data && typeof result.data === "object" && "timedOut" in result.data) {
		return formatApplyGraphResult({ ok: false, ...(result.data as any) });
	}
	return formatCoreFailure(result);
}

export const ghApplyGraphTool = defineTool({
	name: "gh_apply_graph",
	label: "Apply Graph",
	description:
		"Atomically create a new Grasshopper subgraph with local refs (components, widgets, scripts, wires, groups) and built-in validation.",
	parameters: GhApplyGraphInputSchema,
	async execute(_toolCallId, params, _signal, onUpdate) {
		onUpdate?.({
			content: [{ type: "text", text: "Applying Grasshopper graph..." }],
			details: {},
		});
		const result = await applyGraphOperation.execute(params as ApplyGraphInput, operationSignal(_signal));
		if (result.outcome !== "succeeded") {
			return {
				content: [{ type: "text", text: formatApplyGraphFailure(result) }],
				details: operationDetails(result),
			};
		}
		return {
			content: [{ type: "text", text: formatApplyGraphResult({ ok: true, ...(result.data as any) }) }],
			details: operationDetails(result),
		};
	},
});
