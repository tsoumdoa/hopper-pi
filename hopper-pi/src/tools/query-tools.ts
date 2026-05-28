import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { withRequester } from "../infra/request-helpers.js";
import type {
	GetCurrentCanvasResponse,
	GetCanvasErrorsResponse,
} from "../types/messages.js";
import {
	fetchCurrentCanvas,
	formatCanvasResponse,
	formatComponentsMultiQuery,
	getCachedOrFetchComponents,
	fetchCanvasErrors,
	formatCanvasErrorsResponse,
} from "./query-handlers.js";
import { checkCanvasOverlaps } from "./canvas-checks.js";

export const ghGetCanvasTool = defineTool({
	name: "gh_get_canvas",
	label: "Get Canvas",
	description:
		"Fetches the live Grasshopper canvas. With no params, returns a sub-graph index summary. " +
		"Use 'subgraph' to inspect a specific sub-graph.",
	parameters: Type.Object({
		subgraph: Type.Optional(
			Type.String({
				description: 'Show only this sub-graph (e.g. "subgraph_0")',
			}),
		),
	}),

	async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
		onUpdate?.({
			content: [
				{ type: "text", text: "Fetching current canvas from backend..." },
			],
			details: {},
		});
		const response =
			await withRequester<GetCurrentCanvasResponse>(fetchCurrentCanvas);
		const hasFilters = !!params.subgraph;
		return formatCanvasResponse(response, hasFilters ? params : undefined);
	},
});

export const ghListComponentsTool = defineTool({
	name: "gh_list_components",
	label: "List Components",
	description:
		"Search Grasshopper components by keyword. Returns ranked best candidates and grouped results with typeGuids to use as componentType in gh_edit_components. " +
		"Defaults to vanilla components excluding Params. Use searchFrom: 'plugin' or 'params' for other sources. " +
		"Batch likely component names/synonyms in one call instead of making repeated single-query calls. Only paginate if the needed component is not in the best candidates. " +
		"Supports multiple queries and pagination via limit/offset; response includes hasMore and totalMatched. ",
	parameters: Type.Object({
		queries: Type.Array(
			Type.String({
				description:
					"Search terms for names, categories, or descriptions. Batch likely names and synonyms together.",
			}),
		),
		searchFrom:
			Type.Union(
				[
					Type.Literal("vanilla"),
					Type.Literal("plugin"),
					Type.Literal("params"),
				],
				{
					description:
						"Source: 'vanilla' only, 'plugin' only, or 'params' only.",
				},
			),
		limit: Type.Optional(
			Type.Number({
				description: "Max results per query. Default 10, max 100.",
			}),
		),
		offset: Type.Optional(
			Type.Number({
				description: "Pagination start index. Default 0.",
			}),
		),
	}),

	async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
		onUpdate?.({
			content: [{ type: "text", text: "Fetching component registry..." }],
			details: {},
		});
		const response = await getCachedOrFetchComponents();
		return formatComponentsMultiQuery(
			response,
			params.queries,
			params.limit,
			params.offset,
			params.searchFrom ?? "vanilla",
		);
	},
});

export const ghGetCanvasErrorsTool = defineTool({
	name: "gh_get_canvas_errors",
	label: "Get Canvas Errors",
	description:
		"Retrieve all runtime errors, warnings, and messages from the Grasshopper canvas. Returns a per-component list of error/warning bubbles currently showing on the canvas, including script compilation errors.",
	parameters: Type.Object({}),

	async execute(_toolCallId, _params, _signal, onUpdate) {
		onUpdate?.({
			content: [
				{ type: "text", text: "Fetching canvas errors and overlap data..." },
			],
			details: {},
		});
		const [errorsResponse, canvasResponse] = await withRequester(
			async (req) => {
				const [errors, canvas] = await Promise.all([
					fetchCanvasErrors(req),
					fetchCurrentCanvas(req),
				]);
				return [errors, canvas] as [
					GetCanvasErrorsResponse,
					GetCurrentCanvasResponse,
				];
			},
		);
		const overlapResult = checkCanvasOverlaps(canvasResponse.xml);
		return formatCanvasErrorsResponse(errorsResponse, overlapResult);
	},
});
