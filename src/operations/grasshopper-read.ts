import { Type } from "@sinclair/typebox";
import { searchMatchedComponents, paginate, sortedComponents } from "../services/component-search.js";
import { buildGhJson } from "../services/parser/index.js";
import type {
	CanvasError,
	GetCanvasErrorsResponse,
	GetCurrentCanvasResponse,
	GhComponentInfo,
	ListAllComponentsResponse,
} from "../types/messages.js";
import { checkCanvasOverlaps, type CanvasOverlapResult } from "../tools/canvas-checks.js";
import { BLACKLISTED_SUBCATEGORIES, EXCLUDED_TYPE_GUIDS, VANILLA_CATEGORIES } from "../tools/constants.js";
import type { JsonObject, JsonSchema, JsonValue, OperationResult } from "../core/contracts.js";
import { defineOperation, type OperationContext } from "../core/operations.js";
import { preservePiSchemaJson } from "./edit/shared.js";

type GetCanvasInput = JsonObject & {
	subgraph?: string;
	selectionOnly?: boolean;
};

type GetCanvasData = JsonObject & {
	document: JsonObject;
	canvas: JsonValue;
	selectedObjectIds: string[];
};

type ListComponentsInput = JsonObject & {
	queries: string[];
	searchFrom?: "vanilla" | "plugin" | "params";
	limit?: number;
	offset?: number;
};

type ListComponentsData = JsonObject & {
	components: JsonObject[];
	offset: number;
	limit: number;
	total: number;
};

type CanvasErrorsData = JsonObject & {
	errors: JsonObject[];
	overlaps: JsonObject | null;
};

const JsonObjectSchema = Type.Object({}, { additionalProperties: true });
const GetCanvasInputSchema = preservePiSchemaJson(Type.Object({
	subgraph: Type.Optional(Type.String({
		description: 'Show only this sub-graph (e.g. "subgraph_0"). Applied after selectionOnly when both are set.',
	})),
	selectionOnly: Type.Optional(Type.Boolean({
		description: "Return only canvas objects currently selected in Grasshopper (groups expand to members). Includes internal wires between selected components only. Always returns detail view.",
	})),
})) as JsonSchema<GetCanvasInput>;

const GetCanvasOutputSchema = Type.Object({
	document: Type.Object({
		documentId: Type.String(),
		displayName: Type.String(),
		path: Type.Union([Type.String(), Type.Null()]),
	}),
	canvas: Type.Any(),
	selectedObjectIds: Type.Array(Type.String()),
}) as JsonSchema<GetCanvasData>;

const ListComponentsInputSchema = preservePiSchemaJson(Type.Object({
	queries: Type.Array(Type.String({
		description: "One desired component per query string; use multiple words as disambiguating terms.",
	}), { minItems: 1 }),
	searchFrom: Type.Optional(Type.Union([
		Type.Literal("vanilla"),
		Type.Literal("plugin"),
		Type.Literal("params"),
	], {
		description: "Source: 'vanilla' only, 'plugin' only, or 'params' only. Defaults to 'vanilla'.",
	})),
	limit: Type.Optional(Type.Integer({
		minimum: 1,
		maximum: 50,
		description: "Results per query (default 10, max 50)",
	})),
	offset: Type.Optional(Type.Integer({ minimum: 0, description: "Zero-based pagination offset" })),
})) as JsonSchema<ListComponentsInput>;

const ComponentSchema = Type.Object({
	typeGuid: Type.String(),
	name: Type.String(),
	category: Type.String(),
	subcategory: Type.String(),
	description: Type.String(),
}, { additionalProperties: true });

const ListComponentsOutputSchema = Type.Object({
	components: Type.Array(ComponentSchema),
	offset: Type.Integer({ minimum: 0 }),
	limit: Type.Integer({ minimum: 1 }),
	total: Type.Integer({ minimum: 0 }),
}) as JsonSchema<ListComponentsData>;

const CanvasErrorsOutputSchema = Type.Object({
	errors: Type.Array(JsonObjectSchema),
	overlaps: Type.Union([JsonObjectSchema, Type.Null()]),
}) as JsonSchema<CanvasErrorsData>;

function success<T extends JsonValue>(message: string, data: T): OperationResult<T> {
	return { outcome: "succeeded", message, data, warnings: [], artifacts: [], error: null };
}

function failure<T extends JsonValue>(message: string): OperationResult<T> {
	return {
		outcome: "failed",
		message,
		data: null,
		warnings: [],
		artifacts: [],
		error: { code: "operation_failed", message, retryable: false },
	};
}

function asJsonObject(value: unknown): JsonObject {
	return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function componentSource(component: GhComponentInfo): "vanilla" | "plugin" | "params" {
	if (component.category === "Params") return "params";
	return VANILLA_CATEGORIES.has(component.category) ? "vanilla" : "plugin";
}

function isCatalogVisible(component: GhComponentInfo): boolean {
	return !EXCLUDED_TYPE_GUIDS.includes(component.typeGuid)
		&& !BLACKLISTED_SUBCATEGORIES.some((entry) =>
			entry.category === component.category && entry.subcategory === component.subcategory,
		);
}

async function query<T>(context: OperationContext, request: JsonObject): Promise<T> {
	return await context.backend.query(request, context.signal) as T;
}

export const ghGetCanvasOperation = defineOperation<GetCanvasInput, GetCanvasData>({
	name: "gh_get_canvas",
	version: 1,
	description: "Fetch the live Grasshopper canvas as structured data.",
	group: "gh-read",
	possibleScopes: ["none"],
	inputSchema: GetCanvasInputSchema,
	outputSchema: GetCanvasOutputSchema,
	classifyScope: () => "none",
	summarizeInput: (input) => ({
		selectionOnly: input.selectionOnly === true,
		subgraph: input.subgraph ?? null,
	}),
	async execute(input, context) {
		context.reportProgress({ phase: "query", message: "Fetching the Grasshopper canvas." });
		const response = await query<GetCurrentCanvasResponse>(context, {
			type: "getCurrentCanvas",
			selectionOnly: input.selectionOnly === true,
		});
		if (!("xml" in response) || typeof response.xml !== "string") {
			return failure("The backend returned an invalid canvas response.");
		}
		const parsed = asJsonObject(buildGhJson(response.xml));
		const canvas = input.subgraph
			? asJsonObject({ ...parsed, requestedSubgraph: input.subgraph })
			: parsed;
		return success(`Fetched Grasshopper canvas "${response.docName}".`, {
			document: {
				documentId: "ghd_legacy",
				displayName: response.docName,
				path: null,
			},
			canvas,
			selectedObjectIds: response.selectedInstanceGuids ?? [],
		});
	},
});

export const ghListComponentsOperation = defineOperation<ListComponentsInput, ListComponentsData>({
	name: "gh_list_components",
	version: 1,
	description: "Search the Grasshopper component registry and return structured component records.",
	group: "gh-read",
	possibleScopes: ["none"],
	inputSchema: ListComponentsInputSchema,
	outputSchema: ListComponentsOutputSchema,
	classifyScope: () => "none",
	summarizeInput: (input) => ({
		queryCount: input.queries.length,
		searchFrom: input.searchFrom ?? "vanilla",
		limit: input.limit ?? 10,
		offset: input.offset ?? 0,
	}),
	async execute(input, context) {
		context.reportProgress({ phase: "query", message: "Fetching the component registry." });
		const response = await query<ListAllComponentsResponse>(context, { type: "listAllComponents" });
		if (!Array.isArray(response.components)) {
			return failure("The backend returned an invalid component registry response.");
		}
		const source = input.searchFrom ?? "vanilla";
		const visible = response.components.filter(isCatalogVisible);
		const matches = input.queries.flatMap((text) =>
			searchMatchedComponents(visible, text),
		).filter((component) => componentSource(component) === source);
		const unique = [...new Map(matches.map((component) => [component.typeGuid, component])).values()];
		const ordered = sortedComponents(unique);
		const offset = input.offset ?? 0;
		const limit = input.limit ?? 10;
		const page = paginate(ordered, limit, offset);
		return success(`Found ${page.totalMatched} matching Grasshopper component(s).`, {
			components: page.slice.map(asJsonObject),
			offset,
			limit,
			total: page.totalMatched,
		});
	},
});

export const ghGetCanvasErrorsOperation = defineOperation<JsonObject, CanvasErrorsData>({
	name: "gh_get_canvas_errors",
	version: 1,
	description: "Return Grasshopper runtime messages and canvas overlap checks.",
	group: "gh-read",
	possibleScopes: ["none"],
	inputSchema: Type.Object({}) as JsonSchema<JsonObject>,
	outputSchema: CanvasErrorsOutputSchema,
	classifyScope: () => "none",
	summarizeInput: () => ({}),
	async execute(_input, context) {
		context.reportProgress({ phase: "query", message: "Fetching canvas errors." });
		const [errorsResponse, canvasResponse] = await Promise.all([
			query<GetCanvasErrorsResponse>(context, { type: "getCanvasErrors" }),
			query<GetCurrentCanvasResponse>(context, { type: "getCurrentCanvas" }),
		]);
		if (!Array.isArray(errorsResponse.errors) || typeof canvasResponse.xml !== "string") {
			return failure("The backend returned invalid canvas diagnostics.");
		}
		const overlaps: CanvasOverlapResult = checkCanvasOverlaps(canvasResponse.xml);
		return success(`${errorsResponse.errors.length} runtime message(s) found.`, {
			errors: errorsResponse.errors.map((error: CanvasError) => asJsonObject(error)),
			overlaps: asJsonObject(overlaps),
		});
	},
});

export const grasshopperReadOperations = [
	ghGetCanvasOperation,
	ghListComponentsOperation,
	ghGetCanvasErrorsOperation,
] as const;
