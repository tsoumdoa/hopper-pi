import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { createHybridExecute } from "./edit-handlers.js";
import { withRequester } from "../infra/request-helpers.js";
import {
	resolveInstanceGuid,
	resolveRhinoGuids,
	toShortInstanceGuid,
	toShortRhinoGuid,
} from "../services/guid-shortener.js";
import type { CommandAction, RhinoObjectQueryParams, SetParamRhinoGeometryParams } from "../types/commands.js";
import type { GetParamRhinoGeometryResponse } from "../types/messages.js";

import { MAX_RHINO_OBJECT_IDS } from "../config.js";
import { RhinoObjectTypeSchema } from "./schemas.js";

export { MAX_RHINO_OBJECT_IDS };

const rhinoQuerySchema = Type.Object({
	selectionOnly: Type.Optional(Type.Boolean()),
	layer: Type.Optional(Type.String({ minLength: 1 })),
	objectType: Type.Optional(RhinoObjectTypeSchema),
}, {
	description: "Requires layer, objectType, or selectionOnly=true.",
	additionalProperties: false,
});

function formatGetResponse(res: GetParamRhinoGeometryResponse): string {
	const shortTarget = toShortInstanceGuid(res.targetId);
	const lines: string[] = [`Param "${res.paramName}" (${shortTarget})`];

	const formatItem = (item: { path: string; gooType: string; rhinoObjectId?: string }) => {
		const ref = item.rhinoObjectId
			? ` rhino=${toShortRhinoGuid(item.rhinoObjectId)}`
			: "";
		return `  ${item.path}  ${item.gooType}${ref}`;
	};

	if (res.volatileItems.length > 0) {
		lines.push("Volatile (referenced):");
		for (const item of res.volatileItems) {
			lines.push(formatItem(item));
		}
	} else {
		lines.push("Volatile: (empty)");
	}

	if (res.persistentItems.length > 0) {
		lines.push("Persistent (stored on param):");
		for (const item of res.persistentItems) {
			lines.push(formatItem(item));
		}
	} else {
		lines.push("Persistent: (empty)");
	}

	return lines.join("\n");
}

function hasRhinoObjectIds(item: { rhinoObjectIds?: string[] }): boolean {
	return Array.isArray(item.rhinoObjectIds) && item.rhinoObjectIds.length > 0;
}

function rhinoQueryHasFilters(query: RhinoObjectQueryParams): boolean {
	return (
		query.selectionOnly === true
		|| Boolean(query.layer?.trim())
		|| Boolean(query.objectType?.trim())
	);
}

function hasRhinoQuery(item: { rhinoQuery?: RhinoObjectQueryParams }): boolean {
	return item.rhinoQuery != null && rhinoQueryHasFilters(item.rhinoQuery);
}

function buildSetParamParams(
	item: {
		targetId: string;
		action: "reference" | "internalize";
		rhinoObjectIds?: string[];
		rhinoQuery?: SetParamRhinoGeometryParams["rhinoQuery"];
	},
): SetParamRhinoGeometryParams | { error: string } {
	const ids = hasRhinoObjectIds(item);
	const query = hasRhinoQuery(item);

	if (ids && query) {
		return { error: "provide rhinoObjectIds or rhinoQuery, not both" };
	}
	if (!ids && !query) {
		if (item.rhinoQuery != null && typeof item.rhinoQuery === "object") {
			return {
				error:
					"rhinoQuery must include at least one filter (layer, objectType, or selectionOnly: true)",
			};
		}
		return { error: "rhinoObjectIds or rhinoQuery is required" };
	}

	const params: SetParamRhinoGeometryParams = {
		targetId: resolveInstanceGuid(item.targetId),
		mode: item.action,
	};

	if (ids) {
		if (item.rhinoObjectIds!.length > MAX_RHINO_OBJECT_IDS) {
			return {
				error:
					`rhinoObjectIds accepts at most ${MAX_RHINO_OBJECT_IDS} IDs; ` +
					`got ${item.rhinoObjectIds!.length}. Use rhinoQuery for bulk layer/selection.`,
			};
		}
		params.rhinoObjectIds = resolveRhinoGuids(item.rhinoObjectIds!);
	} else {
		params.rhinoQuery = item.rhinoQuery;
	}

	return params;
}

export const ghParamRhinoTool = defineTool({
	name: "gh_param_rhino",
	label: "Param Rhino Geometry",
	description:
		`Get, reference, or internalize Rhino geometry on an existing GH param; use IDs (max ${MAX_RHINO_OBJECT_IDS}) or one filtered query.`,
	parameters: Type.Object({
		items: Type.Array(
			Type.Object({
				action: Type.Union([
					Type.Literal("get"),
					Type.Literal("reference"),
					Type.Literal("internalize"),
				]),
				targetId: Type.String(),
				rhinoObjectIds: Type.Optional(Type.Array(Type.String(), {
					minItems: 1,
					maxItems: MAX_RHINO_OBJECT_IDS,
				})),
				rhinoQuery: Type.Optional(rhinoQuerySchema),
			}, { additionalProperties: false }),
			{ minItems: 1 },
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

			const built = buildSetParamParams({
				...item,
				action: item.action as "reference" | "internalize",
			});
			if ("error" in built) {
				throw new Error(`${item.action} failed: ${built.error}`);
			}

			return {
				action: "setParamRhinoGeometry" as CommandAction,
				params: built,
			};
		},
	),
});
