import { defineTool } from "@earendil-works/pi-coding-agent";
import { toShortRhinoGuid } from "../services/guid-shortener.js";
import { RhQueryObjectsInputSchema } from "../core/schemas.js";
import { formatCoreFailure, operationDetails, operationSignal, prototypeOperation } from "./core-adapter.js";

const queryObjectsOperation = prototypeOperation("rh_query_objects");

export const rhQueryObjectsTool = defineTool({
	name: "rh_query_objects",
	label: "Query Rhino Objects",
	description:
		"List Rhino document objects with short objectId aliases for gh_param_rhino. " +
		"Filter by selection, exact layer, geometry kind, and/or IDs. Use countOnly before large operations. " +
		"For a whole layer or large set, pass the same filters directly to gh_param_rhino.rhinoQuery instead of listing IDs.",
	promptSnippet: "List or count filtered Rhino document objects and return short IDs",
	parameters: RhQueryObjectsInputSchema,

	async execute(_toolCallId, params, signal) {
		const result = await queryObjectsOperation.execute(params, operationSignal(signal));
		if (result.outcome !== "succeeded") {
			return { content: [{ type: "text", text: formatCoreFailure(result) }], details: operationDetails(result) };
		}
		const data = result.data as {
			objects: Array<{ objectId: string; name: string; layer: string; objectType: string }>;
			total: number; offset: number; hasMore: boolean; countOnly: boolean;
		};
		if (data.total === 0) {
			return {
				content: [{ type: "text", text: "No Rhino objects matched the query." }],
				details: operationDetails(result),
			};
		}

		if (data.countOnly) {
			const filters: string[] = [];
			if (params.layer) filters.push(`layer="${params.layer}"`);
			if (params.objectType) filters.push(`type=${params.objectType}`);
			if (params.selectionOnly) filters.push("selectionOnly");
			const filterNote = filters.length > 0 ? ` (${filters.join(", ")})` : "";
			return {
				content: [
					{
						type: "text",
						text:
							`${data.total} Rhino object(s) matched${filterNote}. ` +
							"Use gh_param_rhino with rhinoQuery to reference/internalize in bulk without listing IDs.",
					},
				],
				details: operationDetails(result),
			};
		}

		const lines = data.objects.map((o) => {
			const shortId = toShortRhinoGuid(o.objectId);
			return `${shortId}  ${o.objectType}  layer="${o.layer}"  name="${o.name || "(unnamed)"}"`;
		});

		const header =
			data.total === data.objects.length
				? `${data.total} Rhino object(s):`
				: `${data.total} Rhino object(s) (showing ${data.offset + 1}-${data.offset + data.objects.length}):`;
		const footer = data.hasMore
			? `\n  ... ${data.total - data.offset - data.objects.length} more (call with offset=${data.offset + data.objects.length})`
			: "";

		return {
			content: [
				{
					type: "text",
					text: `${header}\n${lines.join("\n")}${footer}`,
				},
			],
			details: operationDetails(result),
		};
	},
});
