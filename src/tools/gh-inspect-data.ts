import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { withRequester } from "../infra/request-helpers.js";
import { resolveInstanceGuid } from "../services/guid-shortener.js";
import type { InspectDataResponse } from "../types/inspect-data.js";
import { createQueryExecute } from "./execute-factory.js";

const limit = Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Rows per page, default 20. The 8 KiB response cap may return fewer." }));

export const ghInspectDataTool = defineTool({
	name: "gh_inspect_data",
	label: "Inspect Grasshopper Data",
	description:
		"Read Grasshopper runtime input/output data without recomputing. Start with summary on a component ID from gh_get_canvas, " +
		"then use a returned port ID for branches, then items for one branch. Summary returns counts and types, never values. " +
		"Every mode is paged. Fetch only relevant pages; never automatically exhaust cursors. " +
		"Use offset to jump directly to a port, branch, or item. Continue with cursor alone and optional limit. " +
		"Cursors expire on solution/document changes; refresh after a stale cursor error. Values are bounded, geometry is summarized. " +
		"Unsupported/custom values return type-only summaries without running their formatters or validators. " +
		"Phase/locked describe cached data availability, not proof of a current successful result. Input trees are not per-iteration script arguments. " +
		"Use gh_get_canvas_errors for runtime messages.",
	parameters: Type.Object({
		targetId: Type.Optional(Type.String({ description: "Component or port instance GUID, short or full. Required for a new inspection." })),
		mode: Type.Optional(Type.Union([Type.Literal("summary"), Type.Literal("branches"), Type.Literal("items")], { description: "Default summary. Branches and items require a port ID." })),
		side: Type.Optional(Type.Union([Type.Literal("both"), Type.Literal("input"), Type.Literal("output")], { description: "Component summary ports, default both" })),
		path: Type.Optional(Type.String({ maxLength: 512, description: "Exact branch path for items, e.g. {0;2}. Provide path or branchIndex." })),
		branchIndex: Type.Optional(Type.Integer({ minimum: 0, description: "Zero-based branch index from branches mode, alternative to path" })),
		offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 2147483647, description: "Zero-based row offset, default 0" })),
		cursor: Type.Optional(Type.String({ maxLength: 2048, description: "Opaque nextCursor from the previous page. Use with only optional limit." })),
		limit,
	}, { additionalProperties: false }),
	execute: createQueryExecute("Inspecting Grasshopper data...", async (params) => {
		if (!params.cursor && !params.targetId) throw new Error("Provide targetId for a new inspection or cursor to continue.");
		const args = params.cursor ? params : { ...params, targetId: resolveInstanceGuid(params.targetId!) };
		const response = await withRequester(req => req.request<InspectDataResponse & { settings?: unknown; transaction?: unknown }>({ type: "getData", ...args }));
		// The adapter adds document metadata for runtime bookkeeping, not data inspection.
		const { settings: _settings, transaction: _transaction, ...page } = response;
		return { content: [{ type: "text", text: JSON.stringify(page) }], details: {} };
	}),
});
