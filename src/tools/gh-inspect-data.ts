import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { withRequester } from "../infra/request-helpers.js";
import { resolveInstanceGuid } from "../services/guid-shortener.js";
import type { InspectDataResponse } from "../types/inspect-data.js";
import { createQueryExecute } from "./execute-factory.js";

const limit = Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Rows per page, default 20. The 8 KiB cap may return fewer." }));

export const ghInspectDataTool = defineTool({
	name: "gh_inspect_data",
	label: "Inspect Grasshopper Data",
	description:
		"Read cached Grasshopper data without recomputing. Start with a component summary, use a returned port ID for branches, " +
		"then select a branchIndex for items. Scalars, strings, points, and vectors expose values; other types are type-only. " +
		"No item validation or geometry bounds are computed. Fetch only relevant pages; never automatically exhaust cursors. " +
		"Cursors expire on document/solution changes. Phase and locked do not prove results are current. " +
		"Input trees are not per-iteration script arguments. Use gh_get_canvas_errors for runtime messages.",
	parameters: Type.Object({
		targetId: Type.Optional(Type.String({ description: "Required for new inspections. Component or port GUID, short or full; branches and items require a port." })),
		mode: Type.Optional(Type.Union([Type.Literal("summary"), Type.Literal("branches"), Type.Literal("items")], { description: "Defaults to summary, which returns port types and counts. Branches lists paths and counts; items reads values." })),
		side: Type.Optional(Type.Union([Type.Literal("both"), Type.Literal("input"), Type.Literal("output")], { description: "Filters component summary ports only. Defaults to both." })),
		branchIndex: Type.Optional(Type.Integer({ minimum: 0, maximum: 2147483647, description: "Required for items only. Zero-based index from branches mode." })),
		offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 2147483647, description: "Zero-based row offset for the selected mode. Defaults to 0." })),
		cursor: Type.Optional(Type.String({ maxLength: 2048, description: "Continue with nextCursor from the previous page and optional limit. Omit all other fields." })),
		limit,
	}, {
		additionalProperties: false,
		// Keep fields at the top level for schema viewers; requirements depend on the request.
		allOf: [
			{
				if: { required: ["cursor"] },
				then: { not: { anyOf: ["targetId", "mode", "side", "branchIndex", "offset"].map(key => ({ required: [key] })) } },
				else: { required: ["targetId"] },
			},
			{
				if: { required: ["mode"], properties: { mode: { const: "items" } } },
				then: { required: ["branchIndex"] },
				else: { not: { required: ["branchIndex"] } },
			},
		],
	}),
	execute: createQueryExecute("Inspecting Grasshopper data...", async (params) => {
		if (!params.cursor && !params.targetId) throw new Error("Provide targetId for a new inspection or cursor to continue.");
		const args = params.cursor ? params : { ...params, targetId: resolveInstanceGuid(params.targetId!) };
		const response = await withRequester(req => req.request<InspectDataResponse & { settings?: unknown; transaction?: unknown }>({ type: "getData", ...args }));
		// The adapter adds document metadata for runtime bookkeeping, not data inspection.
		const { settings: _settings, transaction: _transaction, ...page } = response;
		return { content: [{ type: "text", text: JSON.stringify(page) }], details: {} };
	}),
});
