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
import { MAX_LIMIT as COMPONENT_MAX_LIMIT } from "../services/component-search.js";
import { ResultOffsetSchema } from "./schemas.js";

export const ghGetCanvasTool = defineTool({
	name: "gh_get_canvas",
	label: "Get Canvas",
	description: "Inspect an existing Grasshopper canvas, subgraph, or current selection.",
	parameters: Type.Object({
		subgraph: Type.Optional(
			Type.String({
				description: 'Subgraph ID such as "subgraph_0".',
			}),
		),
		selectionOnly: Type.Optional(
			Type.Boolean({
				description: "Groups expand to members; returns internal wires.",
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
	description: "Search exact Grasshopper component types when a graph type is unusual, missing, or ambiguous.",
	parameters: Type.Object({
		queries: Type.Array(
			Type.String(),
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
					description: "Default vanilla.",
				},
			),
		),
		limit: Type.Optional(
			Type.Integer({
				minimum: 1,
				maximum: COMPONENT_MAX_LIMIT,
				description: `Results per query (default 10, max ${COMPONENT_MAX_LIMIT})`,
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
	description: "Inspect runtime messages and overlap checks on the current Grasshopper canvas.",
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
