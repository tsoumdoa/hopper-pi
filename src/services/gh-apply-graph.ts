import { assembleCsharpScript } from "./csharp-script-assembler.js";
import { getCachedOrFetchComponents, fetchCanvasErrors, fetchCurrentCanvas } from "../tools/canvas-fetch.js";
import { checkCanvasOverlaps } from "../tools/canvas-checks.js";
import { withRequester } from "../infra/request-helpers.js";
import { toShortInstanceGuid } from "./guid-shortener.js";
import { resolveGraphComponentType } from "./graph-component-resolver.js";
import type {
	ApplyGraphBackendResponse,
	ApplyGraphInput,
	ApplyGraphResult,
	NormalizedApplyGraphRequest,
	NormalizedGraphComponent,
	StructuralError,
} from "../types/gh-apply-graph.js";

const REF_RE = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

function emptyCounts() {
	return { components: 0, widgets: 0, scripts: 0, wires: 0, groups: 0 };
}

export function validateApplyGraphInput(input: ApplyGraphInput): StructuralError[] {
	const errors: StructuralError[] = [];
	const seen = new Set<string>();
	const nodes = [
		...(input.components ?? []).map((node, index) => ({ ...node, path: `components[${index}]` })),
		...(input.widgets ?? []).map((node, index) => ({ ...node, path: `widgets[${index}]` })),
		...(input.scripts ?? []).map((node, index) => ({ ...node, path: `scripts[${index}]` })),
	];

	for (const node of nodes) {
		if (!REF_RE.test(node.ref)) {
			errors.push({
				path: `${node.path}.ref`,
				code: "INVALID_REF",
				message: `Invalid ref "${node.ref}". Use 1-32 letters, digits, "_" or "-", starting with a letter.`,
			});
		} else if (seen.has(node.ref)) {
			errors.push({
				path: `${node.path}.ref`,
				code: "DUPLICATE_REF",
				message: `Duplicate graph ref "${node.ref}".`,
			});
		}
		seen.add(node.ref);
		if (!Number.isFinite(node.x) || !Number.isFinite(node.y) || node.x < 20 || node.y < 20) {
			errors.push({
				path: node.path,
				code: "INVALID_POSITION",
				message: `Node "${node.ref}" must use x and y values of at least 20.`,
			});
		}
	}

	for (const [index, widget] of (input.widgets ?? []).entries()) {
		if (widget.kind === "slider") {
			if (
				!Number.isFinite(widget.min) ||
				!Number.isFinite(widget.max) ||
				!Number.isFinite(widget.value) ||
				widget.min > widget.max
			) {
				errors.push({
					path: `widgets[${index}]`,
					code: "INVALID_WIDGET",
					message: "Slider values must be finite and min must not exceed max.",
				});
			}
			if (widget.digits != null && (!Number.isInteger(widget.digits) || widget.digits < 0 || widget.digits > 12)) {
				errors.push({
					path: `widgets[${index}].digits`,
					code: "INVALID_WIDGET",
					message: "Slider digits must be an integer from 0 through 12.",
				});
			}
		}
		if (
			widget.kind === "valueList" &&
			widget.selectedIndex != null &&
			(widget.selectedIndex < 0 || widget.selectedIndex >= widget.items.length)
		) {
			errors.push({
				path: `widgets[${index}].selectedIndex`,
				code: "INVALID_WIDGET",
				message: "Value-list selectedIndex is outside its items.",
			});
		}
	}

	for (const [index, wire] of (input.wires ?? []).entries()) {
		if (!seen.has(wire.from[0])) {
			errors.push({
				path: `wires[${index}].from`,
				code: "UNKNOWN_REF",
				message: `Wire source ref "${wire.from[0]}" does not exist.`,
			});
		}
		if (!seen.has(wire.to[0])) {
			errors.push({
				path: `wires[${index}].to`,
				code: "UNKNOWN_REF",
				message: `Wire target ref "${wire.to[0]}" does not exist.`,
			});
		}
	}

	for (const [index, group] of (input.groups ?? []).entries()) {
		if (!group.name.trim()) {
			errors.push({
				path: `groups[${index}].name`,
				code: "INVALID_GROUP",
				message: "Group name is required.",
			});
		}
		if (group.refs.length === 0) {
			errors.push({
				path: `groups[${index}].refs`,
				code: "INVALID_GROUP",
				message: `Group "${group.name}" must reference at least one ref.`,
			});
		}
		for (const ref of group.refs) {
			if (!seen.has(ref)) {
				errors.push({
					path: `groups[${index}].refs`,
					code: "UNKNOWN_REF",
					message: `Group "${group.name}" contains unknown ref "${ref}".`,
				});
			}
		}
	}

	for (const [index, script] of (input.scripts ?? []).entries()) {
		const hasCode = typeof script.code === "string" && script.code.trim().length > 0;
		const hasParts = script.scriptParts != null;
		if (script.language === "python" && (!hasCode || hasParts)) {
			errors.push({
				path: `scripts[${index}]`,
				code: "INVALID_SCRIPT_SOURCE",
				message: "Python scripts require code and do not accept scriptParts.",
			});
		}
		if (script.language === "csharp" && hasCode === hasParts) {
			errors.push({
				path: `scripts[${index}]`,
				code: "INVALID_SCRIPT_SOURCE",
				message: "C# scripts require exactly one of code or scriptParts.",
			});
		}
		for (const direction of ["inputs", "outputs"] as const) {
			const names = new Set<string>();
			for (const [portIndex, port] of (script[direction] ?? []).entries()) {
				if (!port.name.trim() || names.has(port.name)) {
					errors.push({
						path: `scripts[${index}].${direction}[${portIndex}].name`,
						code: "INVALID_SCRIPT_PORT",
						message: names.has(port.name)
							? `Duplicate ${direction} port name "${port.name}".`
							: "Script port name is required.",
					});
				}
				names.add(port.name);
			}
		}
	}

	if (nodes.length === 0) {
		errors.push({
			path: "$",
			code: "EMPTY_GRAPH",
			message: "At least one component, widget, or script is required.",
		});
	}

	return errors;
}

export async function normalizeApplyGraphInput(
	input: ApplyGraphInput,
	registryOverride?: { components: import("../types/messages.js").GhComponentInfo[] },
): Promise<{ request?: NormalizedApplyGraphRequest; errors: StructuralError[] }> {
	const errors = validateApplyGraphInput(input);
	const registry = registryOverride ??
		((input.components?.length ?? 0) > 0
			? await getCachedOrFetchComponents()
			: { components: [] });
	const components: NormalizedGraphComponent[] = [];

	for (const [index, node] of (input.components ?? []).entries()) {
		const resolved = resolveGraphComponentType(
			registry.components,
			node.type,
			`components[${index}].type`,
		);
		if (!resolved.ok) {
			errors.push(resolved.error);
			continue;
		}
		const { type: _type, ...rest } = node;
		components.push({ ...rest, typeGuid: resolved.typeGuid });
	}

	if (errors.length > 0) return { errors };

	const scripts = (input.scripts ?? []).map((script) => {
		const { scriptParts, ...rest } = script;
		return {
			...rest,
			code: script.language === "csharp" && scriptParts
				? assembleCsharpScript(scriptParts)
				: script.code ?? "",
		};
	});

	return {
		errors,
		request: {
			type: "applyGraph",
			components,
			widgets: input.widgets ?? [],
			scripts,
			wires: input.wires ?? [],
			groups: input.groups ?? [],
		},
	};
}

function failedResult(errors: StructuralError[]): ApplyGraphResult {
	return {
		ok: false,
		rolledBack: false,
		timedOut: false,
		counts: emptyCounts(),
		refs: {},
		structuralErrors: errors,
		runtimeMessages: [],
		overlaps: null,
		elapsedMs: 0,
	};
}

export function shortenApplyGraphRefs(refs: Record<string, string>): Record<string, string> {
	return Object.fromEntries(
		Object.entries(refs).map(([ref, guid]) => [ref, toShortInstanceGuid(guid)]),
	);
}

export async function executeApplyGraph(input: ApplyGraphInput): Promise<ApplyGraphResult> {
	const normalized = await normalizeApplyGraphInput(input);
	if (!normalized.request) return failedResult(normalized.errors);

	return withRequester(async (requester) => {
		const backend = await requester.request<ApplyGraphBackendResponse | { error: string }>(
			normalized.request,
		);
		if ("error" in backend) {
			return failedResult([{
				path: "$",
				code: "BACKEND_ERROR",
				message: backend.error,
			}]);
		}

		const refs = shortenApplyGraphRefs(backend.refs);
		const base = {
			ok: backend.ok,
			rolledBack: backend.rolledBack,
			timedOut: backend.timedOut,
			counts: backend.counts,
			refs,
			structuralErrors: backend.structuralErrors,
			elapsedMs: backend.elapsedMs,
		};

		if (!backend.ok) {
			return { ...base, runtimeMessages: [], overlaps: null };
		}

		const errorsResponse = await fetchCanvasErrors(requester);
		const canvasResponse = await fetchCurrentCanvas(requester);

		return {
			...base,
			runtimeMessages: errorsResponse.errors,
			overlaps: checkCanvasOverlaps(canvasResponse.xml),
		};
	});
}

export function formatApplyGraphResult(result: ApplyGraphResult): string {
	if (result.timedOut) {
		// Distinct from a normal failure: the apply exceeded the 30s UI-thread
		// window, so the canvas outcome is genuinely unknown (it may have partially
		// or fully applied). Do NOT report this as a clean failure — a blind retry
		// would duplicate the graph. Guide the caller to verify first.
		return [
			"Graph apply timed out: outcome UNKNOWN.",
			"The apply exceeded the 30-second Grasshopper UI-thread window, so the graph may have been partially or fully applied. Do not retry gh_apply_graph blindly — first inspect the canvas (gh_get_canvas) and remove any partial result before re-applying.",
			...result.structuralErrors.map((error) => `${error.path}: ${error.message}`),
		].join("\n");
	}

	if (!result.ok) {
		const lines = [
			`Graph not applied${result.rolledBack ? " (rolled back)" : ""}.`,
			...result.structuralErrors.map(
				(error) =>
					`${error.path}: ${error.message}` +
					(error.candidates?.length ? ` Candidates: ${error.candidates.join(", ")}` : ""),
			),
		];
		return lines.join("\n");
	}

	const { counts } = result;
	const refText = Object.entries(result.refs)
		.map(([ref, id]) => `${ref}=${id}`)
		.join(", ");
	const errorCount = result.runtimeMessages.filter((message) => message.level === "error").length;
	const warningCount = result.runtimeMessages.filter((message) => message.level === "warning").length;
	const overlapCount = result.overlaps
		? result.overlaps.componentOverlaps.length + result.overlaps.groupOverlaps.length
		: 0;

	return [
		`Applied graph: ${counts.components} components, ${counts.widgets} widgets, ` +
			`${counts.scripts} scripts, ${counts.wires} wires, ${counts.groups} groups (${result.elapsedMs}ms).`,
		refText ? `Refs: ${refText}` : "",
		`Validation: ${errorCount} errors, ${warningCount} warnings, ${overlapCount} overlaps.`,
	].filter(Boolean).join("\n");
}
