import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { createQueryExecute } from "./execute-factory.js";
import { withRequester } from "../infra/request-helpers.js";
import type {
	GetCurrentCanvasResponse,
	GetCanvasErrorsResponse,
} from "../types/messages.js";
import {
	fetchCurrentCanvas,
	fetchCanvasErrors,
	getCachedOrFetchComponents,
} from "./canvas-fetch.js";
import { formatCanvasResponse } from "../presenters/canvas-formatter.js";
import {
	formatComponentsMultiQuery,
	formatCanvasErrorsResponse,
} from "./query-handlers.js";
import { checkCanvasOverlaps } from "./canvas-checks.js";

export const ghGetCanvasTool = defineTool({
	name: "gh_get_canvas",
	label: "Get Canvas",
	description:
		"Fetches the live Grasshopper canvas. With no params, returns a sub-graph index summary. " +
		"Use 'subgraph' to inspect a specific sub-graph. " +
		"Use selectionOnly when the user has selected objects on the canvas and you need GUIDs or structure for only that subset (does not replace the single full read after placing all components in a new build).",
	parameters: Type.Object({
		subgraph: Type.Optional(
			Type.String({
				description: 'Show only this sub-graph (e.g. "subgraph_0"). Applied after selectionOnly when both are set.',
			}),
		),
		selectionOnly: Type.Optional(
			Type.Boolean({
				description:
					"Return only canvas objects currently selected in Grasshopper (groups expand to members). " +
					"Includes internal wires between selected components only. Always returns detail view.",
			}),
		),
	}),

	execute: createQueryExecute(
		(params) => params.selectionOnly
			? "Fetching selected canvas objects from backend..."
			: "Fetching current canvas from backend...",
		async (params) => {
			const response = await withRequester<GetCurrentCanvasResponse>((req) =>
				fetchCurrentCanvas(req, { selectionOnly: params.selectionOnly === true }),
			);
			const hasFilters = !!params.subgraph || params.selectionOnly === true;
			return formatCanvasResponse(response, hasFilters ? params : undefined);
		},
	),
});

export const ghListComponentsTool = defineTool({
	name: "gh_list_components",
	label: "List Components",
	description:
		"Search Grasshopper components by keyword. Returns ranked matches grouped by category/subcategory with typeGuids for gh_edit_components. " +
		"Prefer one component per query string (e.g. queries: ['Divide Surface', 'Isotrim']). Multi-word within one query disambiguates (e.g. 'trim brep'). " +
		"Defaults to vanilla components excluding Params. Use searchFrom: 'plugin' or 'params' for other sources. " +
		"Batch separate component names in one call. Paginate with limit/offset if the target is not in the first page.",
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
		"Retrieve all runtime errors, warnings, and messages from the Grasshopper canvas. Surfaces Python tree/list hints when Goo conversion errors appear (e.g. missing list_to_tree).",
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
