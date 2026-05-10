import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { withRequester } from "../infra/request-helpers.js";
import type { ListAllComponentsResponse, GetCurrentCanvasResponse } from "../types/messages.js";
import {
	fetchCurrentCanvas,
	fetchAllComponents,
	formatCanvasResponse,
	formatComponentsList,
} from "./query-handlers.js";

export const ghGetCanvasTool = defineTool({
	name: "gh_get_canvas",
	label: "Get Canvas",
	description:
		"Fetch the live Grasshopper canvas from Rhino/Grasshopper backend. " +
		"Returns every component with its instance GUID and every port GUID. " +
		"You MUST call this before any gh_connect_wire or gh_disconnect_wire — copy the 4 GUID values directly from the output.",
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
		"List all available Grasshopper component types that can be added to the canvas. Returns name, typeGuid, category, subcategory, and description. Use this to find the correct component typeGuid when adding new components.",
	parameters: Type.Object({
		filter: Type.Optional(
			Type.String({
				description:
					"Optional text filter to search component names, categories, or descriptions (case-insensitive partial match)",
			})
		),
	}),

	async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
		onUpdate?.({ content: [{ type: "text", text: "Fetching component registry..." }], details: {} });
		const response = await withRequester<ListAllComponentsResponse>(fetchAllComponents);
		return formatComponentsList(response, params.filter);
	},
});
