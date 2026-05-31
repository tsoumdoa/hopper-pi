import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { createHybridExecute } from "./edit-handlers.js";
import { withRequester } from "../infra/request-helpers.js";
import { resolveInstanceGuid } from "../services/guid-shortener.js";
import type { CommandAction } from "../types/commands.js";
import type { GetParamRhinoGeometryResponse } from "../types/messages.js";

function formatGetResponse(res: GetParamRhinoGeometryResponse): string {
	const lines: string[] = [
		`Param "${res.paramName}" (${res.targetId})`,
	];

	if (res.volatileItems.length > 0) {
		lines.push("Volatile (referenced):");
		for (const item of res.volatileItems) {
			const ref = item.rhinoObjectId ? ` rhino=${item.rhinoObjectId}` : "";
			lines.push(`  ${item.path}  ${item.gooType}${ref}`);
		}
	} else {
		lines.push("Volatile: (empty)");
	}

	if (res.persistentItems.length > 0) {
		lines.push("Persistent (stored on param):");
		for (const item of res.persistentItems) {
			const ref = item.rhinoObjectId ? ` rhino=${item.rhinoObjectId}` : "";
			lines.push(`  ${item.path}  ${item.gooType}${ref}`);
		}
	} else {
		lines.push("Persistent: (empty)");
	}

	return lines.join("\n");
}

export const ghParamRhinoTool = defineTool({
	name: "gh_param_rhino",
	label: "Param Rhino Geometry",
	description:
		"Get, reference, or internalize Rhino geometry on Grasshopper params (Curve, Point, Brep, etc.). " +
		"reference keeps a live Rhino link; internalize copies geometry into the param. " +
		"targetId from gh_get_canvas; rhinoObjectIds from rh_query_objects.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Union([
				Type.Object({
					action: Type.Literal("get"),
					targetId: Type.String({ description: "Geometry param instance GUID" }),
				}),
				Type.Object({
					action: Type.Literal("reference"),
					targetId: Type.String({ description: "Geometry param instance GUID" }),
					rhinoObjectIds: Type.Array(Type.String(), { minItems: 1 }),
				}),
				Type.Object({
					action: Type.Literal("internalize"),
					targetId: Type.String({ description: "Geometry param instance GUID" }),
					rhinoObjectIds: Type.Array(Type.String(), { minItems: 1 }),
				}),
			]),
		),
	}),
	execute: createHybridExecute(
		"get",
		async (item) => {
			const targetId = resolveInstanceGuid(item.targetId);
			const res = await withRequester((req) =>
				req.request<GetParamRhinoGeometryResponse | { error?: string }>({
					type: "getParamRhinoGeometry",
					targetId,
				}),
			);
			if ("error" in res && res.error) {
				return `get failed: ${res.error}`;
			}
			return formatGetResponse(res as GetParamRhinoGeometryResponse);
		},
		(item) => {
			if (item.action === "get") return null;
			return {
				action: "setParamRhinoGeometry" as CommandAction,
				params: {
					targetId: resolveInstanceGuid(item.targetId),
					mode: item.action,
					rhinoObjectIds: item.rhinoObjectIds,
				},
			};
		},
	),
});
