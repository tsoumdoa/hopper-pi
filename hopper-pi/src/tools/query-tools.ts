import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { withRequester } from "../infra/request-helpers.js";
import type { GetCurrentCanvasResponse } from "../types/messages.js";
import {
	fetchCurrentCanvas,
	fetchAllComponents,
	formatCanvasResponse,
	formatComponentsMultiQuery,
	getCachedOrFetchComponents,
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
		"Pass an array of search strings to batch multiple lookups in one call. " +
		"Returns results grouped by query keyword, each containing matching components with name, short typeGuid aliases, category, and subcategory.",
	parameters: Type.Object({
		queries: Type.Optional(
			Type.Array(Type.String({
				description:
					"Search query — filters component names, categories, or descriptions (case-insensitive partial match). Pass multiple to batch.",
			}))
		),
	}),

	async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
		onUpdate?.({ content: [{ type: "text", text: "Fetching component registry..." }], details: {} });
		const response = await getCachedOrFetchComponents();
		return formatComponentsMultiQuery(response, params.queries);
	},
});
