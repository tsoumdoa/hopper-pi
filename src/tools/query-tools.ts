import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
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
import { GhGetCanvasInputSchema, GhListComponentsInputSchema } from "../core/schemas.js";
import { formatCoreFailure, operationDetails, operationSignal, prototypeOperation } from "./core-adapter.js";
import { toShortTypeGuid } from "../services/guid-shortener.js";

const getCanvasOperation = prototypeOperation("gh_get_canvas");
const listComponentsOperation = prototypeOperation("gh_list_components");

export const ghGetCanvasTool = defineTool({
	name: "gh_get_canvas",
	label: "Get Canvas",
	description:
		"Fetch the live Grasshopper canvas. With no filters, returns a subgraph index summary; pass subgraph for one cluster or selectionOnly for the user's current selection. " +
		"After placing a new build, make one unfiltered call to obtain all component and port GUIDs before wiring.",
	promptSnippet: "Inspect Grasshopper canvas structure, selection, IDs, ports, and wires",
	parameters: GhGetCanvasInputSchema,

	async execute(_toolCallId, params, signal, onUpdate) {
		onUpdate?.({
			content: [{ type: "text", text: params.selectionOnly ? "Fetching selected canvas objects from backend..." : "Fetching current canvas from backend..." }],
			details: {},
		});
		const result = await getCanvasOperation.execute(params, operationSignal(signal));
		if (result.outcome !== "succeeded") {
			return { content: [{ type: "text", text: formatCoreFailure(result) }], details: operationDetails(result) };
		}
		const data = result.data as {
			docName: string; componentCount: number; wireCount: number; subGraphCount: number;
			components: Record<string, unknown>; wires: unknown[]; subGraphs: unknown[];
		};
		return {
			content: [{
				type: "text",
				text: `Canvas: ${data.docName} (${data.componentCount} components, ${data.wireCount} wires, ${data.subGraphCount} sub-graphs)\n${JSON.stringify(data)}`,
			}],
			details: operationDetails(result),
		};
	},
});

export const ghListComponentsTool = defineTool({
	name: "gh_list_components",
	label: "List Components",
	description:
		"Search the Grasshopper component registry and return ranked typeGuids for gh_edit_components. " +
		"One desired component per query string; multi-word queries disambiguate. Defaults to vanilla excluding Params.",
	parameters: GhListComponentsInputSchema,

	async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
		onUpdate?.({
			content: [{ type: "text", text: "Fetching component registry..." }],
			details: {},
		});
		const result = await listComponentsOperation.execute(params, operationSignal(_signal));
		if (result.outcome !== "succeeded") {
			return { content: [{ type: "text", text: formatCoreFailure(result) }], details: operationDetails(result) };
		}
		const data = result.data as {
			results: Array<{ query: string; candidates: Array<{ typeGuid: string; name: string; pluginName: string; category: string; subcategory: string; description: string }>; totalMatched: number; hasMore: boolean }>;
			totalAvailable: number;
		};
		const text = data.results.map((entry) => {
			const candidates = entry.candidates.map((candidate) =>
				`${candidate.name} [${toShortTypeGuid(candidate.typeGuid)}] · ${candidate.category}/${candidate.subcategory}`,
			).join("\n");
			return `"${entry.query}" (${entry.totalMatched} matches):\n${candidates || "no matches"}`;
		}).join("\n\n");
		return { content: [{ type: "text", text }], details: operationDetails(result) };
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
