import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { withRequester } from "../infra/request-helpers.js";
import type { QueryRhinoObjectsResponse } from "../types/messages.js";

export const rhQueryObjectsTool = defineTool({
	name: "rh_query_objects",
	label: "Query Rhino Objects",
	description:
		"List Rhino document objects with stable objectId GUIDs for gh_param_rhino. " +
		"Use selectionOnly, layer, objectType (curve|point|brep|surface|mesh), and/or objectIds filters. " +
		"Prefer this over parsing rh_run_script output when you need IDs for Grasshopper params.",
	parameters: Type.Object({
		selectionOnly: Type.Optional(
			Type.Boolean({ description: "Only objects currently selected in Rhino" }),
		),
		layer: Type.Optional(
			Type.String({ description: "Filter by layer name (exact match)" }),
		),
		objectType: Type.Optional(
			Type.String({
				description: "Filter by geometry kind: curve, point, brep, surface, mesh",
			}),
		),
		objectIds: Type.Optional(
			Type.Array(Type.String({ description: "Return only these Rhino object GUIDs" })),
		),
	}),

	async execute(_toolCallId, params) {
		const res = await withRequester((req) =>
			req.request<QueryRhinoObjectsResponse | { error?: string }>({
				type: "queryRhinoObjects",
				...params,
			}),
		);

		if ("error" in res && res.error) {
			return {
				content: [{ type: "text", text: `FAILED: ${res.error}` }],
				details: {},
			};
		}

		const objects = "objects" in res ? res.objects : [];
		if (objects.length === 0) {
			return {
				content: [{ type: "text", text: "No Rhino objects matched the query." }],
				details: {},
			};
		}

		const lines = objects.map(
			(o) =>
				`${o.objectId}  ${o.objectType}  layer="${o.layer}"  name="${o.name || "(unnamed)"}"`,
		);
		return {
			content: [
				{
					type: "text",
					text: `${objects.length} Rhino object(s):\n${lines.join("\n")}`,
				},
			],
			details: {},
		};
	},
});
