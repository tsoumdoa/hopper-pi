import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { withRequester } from "../infra/request-helpers.js";
import { resolveInstanceGuid } from "../services/guid-shortener.js";
import type { InspectDataResponse } from "../types/inspect-data.js";
import { createQueryExecute } from "./execute-factory.js";

const limit = Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Optional in every mode and with cursor. Rows per page, default 20. The 8 KiB response cap may return fewer." }));

export const ghInspectDataTool = defineTool({
	name: "gh_inspect_data",
	label: "Inspect Grasshopper Data",
	description:
		"Read Grasshopper runtime input/output data without recomputing. Start with summary on a component ID from gh_get_canvas, " +
		"then set targetId to a returned port ID for branches. For items, keep that targetId and provide exactly one of branchIndex or path. Summary returns counts and types, never values. " +
		"Every mode is paged. Fetch only relevant pages; never automatically exhaust cursors. " +
		"Use offset to jump directly to a port, branch, or item. Continue with cursor alone and optional limit. " +
		"Cursors expire on solution/document changes; refresh after a stale cursor error. Values are bounded, geometry is summarized. " +
		"Unsupported/custom values return type-only summaries without running their formatters or validators. " +
		"Phase/locked describe cached data availability, not proof of a current successful result. Input trees are not per-iteration script arguments. " +
		"Use gh_get_canvas_errors for runtime messages.",
	parameters: Type.Object({
		targetId: Type.Optional(Type.String({ description: "Required unless cursor is provided. Component or port instance GUID, short or full, for summary; port instance GUID for branches and items. Omit with cursor." })),
		mode: Type.Optional(Type.Union([Type.Literal("summary"), Type.Literal("branches"), Type.Literal("items")], { description: "Optional, defaults to summary. For branches and items, set targetId to a port ID. Items also requires exactly one of branchIndex or path. Omit with cursor." })),
		side: Type.Optional(Type.Union([Type.Literal("both"), Type.Literal("input"), Type.Literal("output")], { description: "Optional, defaults to both. Filters ports in component summary only; ignored for other targets and modes. Omit with cursor." })),
		path: Type.Optional(Type.String({ maxLength: 512, description: "For items only: exact branch path, e.g. {0;2}. Required if branchIndex is omitted; do not provide both. Omit with cursor." })),
		branchIndex: Type.Optional(Type.Integer({ minimum: 0, description: "For items only: zero-based branchIndex returned by branches mode. Required if path is omitted; do not provide both. Omit with cursor." })),
		offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 2147483647, description: "Optional, defaults to 0. Zero-based port, branch, or item row offset for the selected mode. Omit with cursor." })),
		cursor: Type.Optional(Type.String({ maxLength: 2048, description: "Required only to continue a page. Use nextCursor from the previous response with optional limit; omit every other field." })),
		limit,
	}, {
		additionalProperties: false,
		// Keep fields at the top level for schema viewers; requirements depend on the request.
		allOf: [
			{
				if: { required: ["cursor"] },
				then: { not: { anyOf: ["targetId", "mode", "side", "path", "branchIndex", "offset"].map(key => ({ required: [key] })) } },
				else: { required: ["targetId"] },
			},
			{
				if: { required: ["mode"], properties: { mode: { const: "items" } } },
				then: { oneOf: [{ required: ["path"] }, { required: ["branchIndex"] }] },
				else: { not: { anyOf: [{ required: ["path"] }, { required: ["branchIndex"] }] } },
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
