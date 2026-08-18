import { Value } from "@sinclair/typebox/value";
import type { TSchema } from "@sinclair/typebox";
import { Requester, RequestTransportError, type RequestOptions } from "../infra/requester.js";
import { applyCanvasExclusions, applySelectionFilter } from "../services/canvas-filter.js";
import { paginate, searchMatchedComponents, sortedComponents } from "../services/component-search.js";
import { validateApplyGraphInput, normalizeApplyGraphInput } from "../services/gh-apply-graph.js";
import { checkCanvasOverlaps } from "../tools/canvas-checks.js";
import { BLACKLISTED_SUBCATEGORIES, EXCLUDED_TYPE_GUIDS, VANILLA_CATEGORIES } from "../tools/constants.js";
import { buildGhJson } from "../services/parser.js";
import { computeSubGraphs } from "../services/subgraph.js";
import { resolveRhinoGuid } from "../services/guid-shortener.js";
import { validateRhinoScriptItem } from "../services/rhino-script-validator.js";
import type { ApplyGraphInput, ApplyGraphBackendResponse } from "../types/gh-apply-graph.js";
import type {
	AuthErrorResponse,
	GetCanvasErrorsResponse,
	GetCurrentCanvasResponse,
	ListAllComponentsResponse,
	QueryRhinoObjectsResponse,
	RunRhinoScriptResponse,
} from "../types/messages.js";
import type { DocumentTarget, OperationFailure, OperationResult, PrototypeOperation } from "./contracts.js";
import { ERROR_CODE } from "./contracts.js";
import {
	ApplyGraphBackendResponseSchema,
	AuthErrorResponseSchema,
	CanvasBackendResponseSchema,
	CanvasErrorsBackendResponseSchema,
	ComponentsBackendResponseSchema,
	QueryRhinoObjectsBackendResponseSchema,
	RunRhinoScriptBackendResponseSchema,
} from "./backend-schemas.js";
import {
	GhApplyGraphInputSchema,
	GhApplyGraphOutputSchema,
	GhGetCanvasInputSchema,
	GhGetCanvasOutputSchema,
	GhListComponentsInputSchema,
	GhListComponentsOutputSchema,
	RhQueryObjectsInputSchema,
	RhQueryObjectsOutputSchema,
	RhRunScriptInputSchema,
	RhRunScriptOutputSchema,
	type GhGetCanvasInput,
	type GhListComponentsInput,
	type RhQueryObjectsInput,
	type RhRunScriptInput,
} from "./schemas.js";

export type BackendRequest = (
	payload: Record<string, unknown>,
	options: RequestOptions,
) => Promise<unknown>;

export async function defaultBackendRequest(payload: Record<string, unknown>, options: RequestOptions): Promise<unknown> {
	const requester = new Requester();
	try {
		await requester.connect();
		return await requester.request(payload, options);
	} finally {
		await requester.close();
	}
}

function failed(
	code: string,
	message: string,
	options: Partial<Pick<OperationFailure, "outcome" | "target" | "data">> & { retryable?: boolean } = {},
): OperationFailure {
	return {
		outcome: options.outcome ?? "failed",
		message,
		target: options.target ?? null,
		data: options.data ?? null,
		error: { code, message, retryable: options.retryable ?? false },
	};
}

function transportFailure(error: unknown, mutates: boolean, verifyWith: string): OperationFailure {
	if (error instanceof RequestTransportError) {
		if (mutates && error.mutationInFlight) {
			const message = `Mutation outcome is unknown. Inspect with ${verifyWith} before deciding whether to retry.`;
			return failed(ERROR_CODE.MUTATION_OUTCOME_UNKNOWN, message, { outcome: "unknown" });
		}
		const interrupted = error.kind === "aborted";
		return failed(
			interrupted ? ERROR_CODE.INTERRUPTED : ERROR_CODE.BACKEND_UNAVAILABLE,
			interrupted ? "Request interrupted" : "Backend is unavailable or did not respond in time",
			{ retryable: !interrupted },
		);
	}
	return failed(ERROR_CODE.INTERNAL_ERROR, "Operation failed before receiving a valid backend response");
}

function responseFailure(raw: unknown, schema: TSchema, mutates: boolean, verifyWith: string): OperationFailure | null {
	if (Value.Check(AuthErrorResponseSchema, raw)) {
		return failed(ERROR_CODE.AUTHENTICATION_FAILED, "Backend authentication failed");
	}
	if (!Value.Check(schema, raw)) {
		if (mutates) {
			return failed(
				ERROR_CODE.MUTATION_OUTCOME_UNKNOWN,
				`Backend response was invalid. Inspect with ${verifyWith} before deciding whether to retry.`,
				{ outcome: "unknown" },
			);
		}
		return failed(ERROR_CODE.MALFORMED_BACKEND_RESPONSE, "Backend returned an invalid response");
	}
	return null;
}

async function checkedRequest<T>(
	request: BackendRequest,
	payload: Record<string, unknown>,
	schema: TSchema,
	options: RequestOptions & { verifyWith: string },
): Promise<T | OperationFailure> {
	try {
		const raw = await request(payload, options);
		const invalid = responseFailure(raw, schema, options.mutates === true, options.verifyWith);
		return invalid ?? raw as T;
	} catch (error) {
		return transportFailure(error, options.mutates === true, options.verifyWith);
	}
}

function isFailure(value: unknown): value is OperationFailure {
	return !!value && typeof value === "object" && "outcome" in value && "error" in value;
}

function isBlacklisted(category: string, subcategory: string): boolean {
	return BLACKLISTED_SUBCATEGORIES.some((item) => item.category === category && item.subcategory === subcategory);
}

export function createPrototypeOperations(request: BackendRequest = defaultBackendRequest): PrototypeOperation[] {
	const getCanvas: PrototypeOperation<GhGetCanvasInput> = {
		name: "gh_get_canvas",
		namespace: "gh",
		publicName: "get-canvas",
		description: "Inspect the connected Grasshopper canvas and return parsed graph data with full GUIDs.",
		inputSchema: GhGetCanvasInputSchema,
		outputSchema: GhGetCanvasOutputSchema,
		mutates: false,
		async execute(input, signal) {
			const response = await checkedRequest<GetCurrentCanvasResponse>(request, {
				type: "getCurrentCanvas",
				...(input.selectionOnly ? { selectionOnly: true } : {}),
			}, CanvasBackendResponseSchema, { signal, mutates: false, verifyWith: "gh call get-canvas" });
			if (isFailure(response)) return response;

			const parsed = buildGhJson(response.xml);
			let { components, wires } = applyCanvasExclusions(parsed);
			if (input.selectionOnly) ({ components, wires } = applySelectionFilter(components, wires, response));
			let subGraphs = computeSubGraphs({ version: parsed.version, components, wires });
			if (input.subgraph) {
				const selected = subGraphs.find((item) => item.id === input.subgraph);
				if (selected) {
					const ids = new Set(selected.components);
					components = Object.fromEntries(Object.entries(components).filter(([id]) => ids.has(id)));
					wires = wires.filter((wire) => ids.has(wire.from.split(".")[0]) && ids.has(wire.to.split(".")[0]));
					subGraphs = [selected];
				} else {
					components = {};
					wires = [];
					subGraphs = [];
				}
			}
			const data = {
				docName: response.docName,
				componentCount: Object.keys(components).length,
				wireCount: wires.length,
				subGraphCount: subGraphs.length,
				components,
				wires,
				subGraphs,
			};
			return { outcome: "succeeded", message: "Connected Grasshopper canvas inspected", target: response.target as DocumentTarget, data, error: null };
		},
	};

	const listComponents: PrototypeOperation<GhListComponentsInput> = {
		name: "gh_list_components",
		namespace: "gh",
		publicName: "list-components",
		description: "Search the component registry loaded by Grasshopper. Full type GUIDs are stable across CLI processes.",
		inputSchema: GhListComponentsInputSchema,
		outputSchema: GhListComponentsOutputSchema,
		mutates: false,
		async execute(input, signal) {
			const response = await checkedRequest<ListAllComponentsResponse>(request, { type: "listAllComponents" }, ComponentsBackendResponseSchema, { signal, mutates: false, verifyWith: "gh call list-components" });
			if (isFailure(response)) return response;
			const source = input.searchFrom ?? "vanilla";
			const available = sortedComponents(response.components
				.filter((item) => !EXCLUDED_TYPE_GUIDS.includes(item.typeGuid))
				.filter((item) => !isBlacklisted(item.category, item.subcategory))
				.filter((item) => {
					if (source === "all") return true;
					if (source === "params") return item.category === "Params";
					if (source === "plugin") return !VANILLA_CATEGORIES.has(item.category);
					return VANILLA_CATEGORIES.has(item.category) && item.category !== "Params";
				}));
			const results = input.queries.map((query) => {
				const matched = searchMatchedComponents(available, query);
				const page = paginate(matched, input.limit, input.offset);
				return {
					query,
					candidates: page.slice.map(({ typeGuid, name, pluginName, category, subcategory, description }) => ({ typeGuid, name, pluginName, category, subcategory, description })),
					totalMatched: page.totalMatched,
					hasMore: page.hasMore,
				};
			});
			return { outcome: "succeeded", message: "Component registry searched", target: response.target as DocumentTarget, data: { results, totalAvailable: available.length }, error: null };
		},
	};

	const applyGraph: PrototypeOperation<ApplyGraphInput> = {
		name: "gh_apply_graph",
		namespace: "gh",
		publicName: "apply-graph",
		description: "Create and validate one Grasshopper subgraph. The backend rolls back known apply failures; timeouts have an unknown outcome.",
		inputSchema: GhApplyGraphInputSchema,
		outputSchema: GhApplyGraphOutputSchema,
		mutates: true,
		async execute(input, signal) {
			const localErrors = validateApplyGraphInput(input);
			if (localErrors.length > 0) return failed(ERROR_CODE.INPUT_SCHEMA_INVALID, localErrors.map((error) => `${error.path}: ${error.message}`).join("; "));

			let registry = { components: [] } as Pick<ListAllComponentsResponse, "components">;
			if ((input.components?.length ?? 0) > 0) {
				const response = await checkedRequest<ListAllComponentsResponse>(request, { type: "listAllComponents" }, ComponentsBackendResponseSchema, { signal, mutates: false, verifyWith: "gh call list-components" });
				if (isFailure(response)) return response;
				registry = response;
			}
			const normalized = await normalizeApplyGraphInput(input, registry as ListAllComponentsResponse);
			if (!normalized.request) return failed(ERROR_CODE.INPUT_SCHEMA_INVALID, normalized.errors.map((error) => `${error.path}: ${error.message}`).join("; "));
			const response = await checkedRequest<ApplyGraphBackendResponse>(request, normalized.request as unknown as Record<string, unknown>, ApplyGraphBackendResponseSchema, { signal, mutates: true, verifyWith: "gh call get-canvas" });
			if (isFailure(response)) return response;
			const baseData = {
				rolledBack: response.rolledBack,
				timedOut: response.timedOut,
				counts: response.counts,
				refs: response.refs,
				structuralErrors: response.structuralErrors,
				runtimeMessages: [] as GetCanvasErrorsResponse["errors"],
				overlaps: null as ReturnType<typeof checkCanvasOverlaps> | null,
				elapsedMs: response.elapsedMs,
			};
			if (response.timedOut) {
				return failed(ERROR_CODE.MUTATION_OUTCOME_UNKNOWN, "Graph apply timed out. Inspect with gh call get-canvas before deciding whether to retry.", { outcome: "unknown", target: response.target as DocumentTarget, data: baseData });
			}
			if (!response.ok) {
				if (!response.rolledBack) {
					return failed(ERROR_CODE.MUTATION_OUTCOME_UNKNOWN, "Graph apply failed and rollback was not confirmed. Inspect with gh call get-canvas before deciding whether to retry.", { outcome: "unknown", target: response.target as DocumentTarget, data: baseData });
				}
				return failed(ERROR_CODE.OPERATION_FAILED, "Graph was not applied", { target: response.target as DocumentTarget, data: baseData });
			}

			const errors = await checkedRequest<GetCanvasErrorsResponse>(request, { type: "getCanvasErrors" }, CanvasErrorsBackendResponseSchema, { signal, mutates: false, verifyWith: "gh call get-canvas" });
			const canvas = await checkedRequest<GetCurrentCanvasResponse>(request, { type: "getCurrentCanvas" }, CanvasBackendResponseSchema, { signal, mutates: false, verifyWith: "gh call get-canvas" });
			if (!isFailure(errors)) baseData.runtimeMessages = errors.errors;
			if (!isFailure(canvas)) baseData.overlaps = checkCanvasOverlaps(canvas.xml);
			return { outcome: "succeeded", message: "Grasshopper graph applied", target: response.target as DocumentTarget, data: baseData, error: null };
		},
	};

	const queryRhino: PrototypeOperation<RhQueryObjectsInput> = {
		name: "rh_query_objects",
		namespace: "rh",
		publicName: "query-objects",
		description: "Inspect filtered objects in the active Rhino document and return full object GUIDs.",
		inputSchema: RhQueryObjectsInputSchema,
		outputSchema: RhQueryObjectsOutputSchema,
		mutates: false,
		async execute(input, signal) {
			const response = await checkedRequest<QueryRhinoObjectsResponse>(request, {
				type: "queryRhinoObjects",
				selectionOnly: input.selectionOnly,
				layer: input.layer,
				objectType: input.objectType,
				objectIds: input.objectIds?.map(resolveRhinoGuid),
			}, QueryRhinoObjectsBackendResponseSchema, { signal, mutates: false, verifyWith: "rh call query-objects" });
			if (isFailure(response)) return response;
			const total = response.objects.length;
			const offset = Math.max(input.offset ?? 0, 0);
			const limit = Math.min(input.limit ?? 50, 100);
			const objects = input.countOnly ? [] : response.objects.slice(offset, offset + limit);
			return { outcome: "succeeded", message: `${total} Rhino object(s) matched`, target: response.target as DocumentTarget, data: { objects, total, offset, hasMore: !input.countOnly && offset + objects.length < total, countOnly: input.countOnly ?? false }, error: null };
		},
	};

	const runScript: PrototypeOperation<RhRunScriptInput> = {
		name: "rh_run_script",
		namespace: "rh",
		publicName: "run-script",
		description: "Run Rhino command, Python, or C# items in order. The call is non-atomic and does not promise one undo record; any item failure has an unknown outcome.",
		inputSchema: RhRunScriptInputSchema,
		outputSchema: RhRunScriptOutputSchema,
		mutates: true,
		async execute(input, signal) {
			for (const item of input.items) {
				const error = validateRhinoScriptItem(item);
				if (error) return failed(ERROR_CODE.INPUT_SCHEMA_INVALID, String(error));
			}
			const items: Array<{ index: number; mode: "command" | "python" | "csharp"; ok: boolean; output: string; error: string | null }> = [];
			let target: DocumentTarget | null = null;
			for (const [index, item] of input.items.entries()) {
				const response = await checkedRequest<RunRhinoScriptResponse>(request, {
					type: "runRhinoScript", mode: item.mode, source: item.source, echo: item.echo ?? false,
				}, RunRhinoScriptBackendResponseSchema, { signal, mutates: true, verifyWith: "rh call query-objects" });
				if (isFailure(response)) {
					if (items.length > 0) {
						return failed(
							ERROR_CODE.MUTATION_OUTCOME_UNKNOWN,
							"A later Rhino script item failed after an earlier item completed. Inspect with rh call query-objects before deciding whether to retry.",
							{ outcome: "unknown", target: response.target ?? target, data: { items } },
						);
					}
					return { ...response, target: response.target ?? target, data: { items } };
				}
				target = response.target as DocumentTarget;
				const sources = input.items.map((candidate) => candidate.source);
				items.push({
					index,
					mode: item.mode,
					ok: response.ok,
					output: response.ok ? response.output : redactScriptSource(response.output, sources),
					error: response.error ? redactScriptSource(response.error, sources) : null,
				});
				if (!response.ok) {
					return failed(ERROR_CODE.MUTATION_OUTCOME_UNKNOWN, "A Rhino script item failed after execution began. Inspect with rh call query-objects before deciding whether to retry.", { outcome: "unknown", target, data: { items } });
				}
			}
			return { outcome: "succeeded", message: `${items.length} Rhino script item(s) completed`, target: target!, data: { items }, error: null };
		},
	};

	return [getCanvas, listComponents, applyGraph, queryRhino, runScript];
}

export const PROTOTYPE_OPERATIONS = createPrototypeOperations();

export function findOperation(namespace: "gh" | "rh", publicName: string, operations = PROTOTYPE_OPERATIONS): PrototypeOperation | undefined {
	return operations.find((operation) => operation.namespace === namespace && operation.publicName === publicName);
}

function redactScriptSource(message: string, sources: string[]): string {
	let safe = message;
	for (const source of sources) {
		if (!source) continue;
		if (safe.includes(source)) safe = safe.split(source).join("[redacted script source]");
		for (const line of source.split(/\r?\n/).map((item) => item.trim()).filter((item) => item.length >= 4)) {
			if (safe.includes(line)) safe = safe.split(line).join("[redacted source line]");
		}
	}
	return safe;
}
