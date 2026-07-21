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
import { formatCanvasResponse } from "./canvas-formatters.js";
import {
	formatComponentsMultiQuery,
	formatCanvasErrorsResponse,
} from "./query-handlers.js";
import { checkCanvasOverlaps } from "./canvas-checks.js";
import { MAX_LIMIT as COMPONENT_MAX_LIMIT, DEFAULT_LIMIT as COMPONENT_DEFAULT_LIMIT } from "../services/component-search.js";
import { ResultOffsetSchema } from "./schemas.js";
import { resolveInstanceGuid } from "../services/guid-shortener.js";

export const ghGetCanvasTool = defineTool({
	name: "gh_get_canvas",
	label: "Get Canvas",
	description:
		"Fetch the live Grasshopper canvas. With no filters, returns a subgraph index summary; pass subgraph for one cluster, selectionOnly for the user's current selection, or componentIds for specific components (detail view, cheapest targeted read). " +
		"The header reports Rhino document units and tolerance. add operations already return component and port GUIDs, so a canvas read before wiring is only needed when those were lost.",
	promptSnippet: "Inspect Grasshopper canvas structure, selection, IDs, ports, and wires",
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
		componentIds: Type.Optional(
			Type.Array(
				Type.String({ description: "Component instance GUID (short or full)" }),
				{
					minItems: 1,
					maxItems: 50,
					description:
						"Return only these components (detail view with ports). Use for targeted lookups instead of dumping a whole subgraph.",
				},
			),
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
			const hasFilters = !!params.subgraph || params.selectionOnly === true || !!params.componentIds?.length;
			return formatCanvasResponse(
				response,
				hasFilters
					? {
							subgraph: params.subgraph,
							selectionOnly: params.selectionOnly,
							componentIds: params.componentIds?.map(resolveInstanceGuid),
						}
					: undefined,
			);
		},
	),
});

export const ghListComponentsTool = defineTool({
	name: "gh_list_components",
	label: "List Components",
	description:
		"Search the Grasshopper component registry and return ranked typeGuids for gh_edit_components. Put each desired component in its own query string; use multi-word queries to disambiguate. " +
		"Defaults to vanilla components excluding Params; choose plugin or params explicitly when needed. Widgets are created with gh_create_widget, not a searched typeGuid.",
	promptSnippet: "Search Grasshopper component types and return typeGuids for creation",
	parameters: Type.Object({
		queries: Type.Array(
			Type.String({
				description:
					"One desired component per query string; use multiple words as disambiguating terms.",
			}),
			{ minItems: 1 },
		),
		searchFrom: Type.Optional(
			Type.Union(
				[
					Type.Literal("vanilla"),
					Type.Literal("plugin"),
					Type.Literal("params"),
				],
				{
					description:
						"Source: 'vanilla' only, 'plugin' only, or 'params' only. Defaults to 'vanilla'.",
				},
			),
		),
		limit: Type.Optional(
			Type.Integer({
				minimum: 1,
				maximum: COMPONENT_MAX_LIMIT,
				description: `Results per query (default ${COMPONENT_DEFAULT_LIMIT}, max ${COMPONENT_MAX_LIMIT})`,
			}),
		),
		offset: Type.Optional(ResultOffsetSchema),
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
		"Retrieve Grasshopper runtime errors, warnings, messages, and component-overlap checks. Call after wiring or layout changes; Goo conversion errors include Python tree/list repair hints.",
	promptSnippet: "Validate Grasshopper runtime messages and detect component overlaps",
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
