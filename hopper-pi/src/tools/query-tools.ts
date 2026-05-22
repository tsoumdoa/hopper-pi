import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { withRequester } from "../infra/request-helpers.js";
import type { GetCurrentCanvasResponse, GetCanvasErrorsResponse } from "../types/messages.js";
import {
	fetchCurrentCanvas,
	formatCanvasResponse,
	formatComponentsMultiQuery,
	getCachedOrFetchComponents,
	fetchCanvasErrors,
	formatCanvasErrorsResponse,
} from "./query-handlers.js";

export const ghGetCanvasTool = defineTool({
	name: "gh_get_canvas",
	label: "Get Canvas",
	description:
		"Fetch the live Grasshopper canvas from Rhino/Grasshopper backend. " +
		"Returns every component with short instance GUID aliases and every port GUID alias (mapped internally to full GUIDs). " +
		"You MUST call this before any gh_connect_wire or gh_disconnect_wire — copy the 4 GUID aliases directly from the output.",
	parameters: Type.Object({}),

	async execute(_toolCallId, _params, _signal, onUpdate, _ctx) {
		onUpdate?.({ content: [{ type: "text", text: "Fetching current canvas from backend..." }], details: {} });
		const response = await withRequester<GetCurrentCanvasResponse>(fetchCurrentCanvas);
		return formatCanvasResponse(response);
	},
});

export const ghListComponentsTool = defineTool({
	name: "gh_list_components",
	label: "List Components",
	description:
		"Search available Grasshopper component types by query keywords. " +
		"Returns name, typeGuid, category, subcategory, and description for each match. " +
		"Pass an array of search strings to batch multiple lookups in one call. " +
		"Results are paginated — use limit (default 20) and offset (default 0) to control the window. " +
		"The response includes hasMore and totalMatched so you can paginate through large result sets.",
	parameters: Type.Object({
		queries:
			Type.Array(Type.String({
				description:
					"Search query — filters component names, categories, or descriptions (case-insensitive partial match). Pass multiple to batch.",
			})),
		limit: Type.Optional(
			Type.Number({ description: "Max results per query (default 20, max 100)" })
		),
		offset: Type.Optional(
			Type.Number({ description: "Starting index for pagination (default 0)" })
		),
	}),

	async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
		onUpdate?.({ content: [{ type: "text", text: "Fetching component registry..." }], details: {} });
		const response = await getCachedOrFetchComponents();
		return formatComponentsMultiQuery(response, params.queries, params.limit, params.offset);
	},
});

export const ghGetCanvasErrorsTool = defineTool({
	name: "gh_get_canvas_errors",
	label: "Get Canvas Errors",
	description:
		"Retrieve all runtime errors, warnings, and messages from the Grasshopper canvas. Returns a per-component list of error/warning bubbles currently showing on the canvas, including script compilation errors.",
	parameters: Type.Object({}),

	async execute(_toolCallId, _params, _signal, onUpdate) {
		onUpdate?.({ content: [{ type: "text", text: "Fetching canvas errors from backend..." }], details: {} });
		const response = await withRequester<GetCanvasErrorsResponse>(fetchCanvasErrors);
		return formatCanvasErrorsResponse(response);
	},
});
