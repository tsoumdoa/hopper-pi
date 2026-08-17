import { Type, type Static, type TSchema } from "@sinclair/typebox";
import type {
	BackendAction,
	ExecuteActionsResponse,
	JsonObject,
	JsonValue,
	OperationResult,
} from "../../core/contracts.js";
import type { OperationContext, PreparedMutation } from "../../core/operations.js";
import type { HopperError } from "../../core/errors.js";

export const SliderCreateFields = Type.Object({
	min: Type.Number(),
	max: Type.Number(),
	value: Type.Number(),
	digits: Type.Integer({ minimum: 0, maximum: 12, description: "Decimal places" }),
});

export const SliderSetFields = Type.Object({ value: Type.Number() });

export const SliderRangeFields = Type.Object({
	min: Type.Number(),
	max: Type.Number(),
	digits: Type.Integer({ minimum: 0, maximum: 12, description: "Decimal places" }),
});

export const PanelTextOutputType = Type.Union([
	Type.Literal("singleString"),
	Type.Literal("oneItemPerLine"),
], {
	description:
		"How panel text becomes downstream data. singleString: entire text is one string (newlines preserved). oneItemPerLine: each line is a separate list item.",
});

export const PanelCreateFields = Type.Object({
	text: Type.String(),
	textOutput: PanelTextOutputType,
	width: Type.Optional(Type.Number()),
	height: Type.Optional(Type.Number()),
	bgColor: Type.Optional(Type.String({ description: "rgba string, e.g. 'rgba(255,0,0,255)'" })),
});

export const PanelPropertyFields = Type.Object({
	textOutput: PanelTextOutputType,
	width: Type.Optional(Type.Number()),
	height: Type.Optional(Type.Number()),
	bgColor: Type.Optional(Type.String({ description: "rgba string, e.g. 'rgba(255,0,0,255)'" })),
});

export const PanelTextFields = Type.Object({ text: Type.String() });
export const ToggleFields = Type.Object({ value: Type.Boolean() });
export const SwatchFields = Type.Object({
	color: Type.String({ description: "rgba string, e.g. 'rgba(255,0,0,255)'" }),
});
export const ScribbleCreateFields = Type.Object({
	text: Type.String(),
	size: Type.Optional(Type.Number()),
});
export const ScribbleTextFields = Type.Object({ text: Type.String() });
export const ValueListItemFields = Type.Object({ name: Type.String(), value: Type.String() });
export const ValueListCreateFields = Type.Object({
	items: Type.Array(ValueListItemFields, { minItems: 1 }),
	selectedIndex: Type.Optional(Type.Number()),
});
export const ValueListSelectFields = Type.Object({
	selectedIndex: Type.Integer({ minimum: 0 }),
});

/**
 * Pi's Type export uses the same JSON Schema vocabulary as TypeBox but emits
 * keywords in the older TypeBox order. Keep that byte order during the PR 1
 * extraction so the frozen schemas do not change as a side effect of moving
 * away from Pi's re-export.
 */
export function preservePiSchemaJson<T extends TSchema>(schema: T): T {
	function visit(value: unknown): unknown {
		if (Array.isArray(value)) return value.map(visit);
		if (!value || typeof value !== "object") return value;

		const source = value as Record<string | symbol, unknown>;
		const strings = Object.keys(source);
		const result: Record<string | symbol, unknown> = {};
		const append = (key: string) => {
			if (key in source) result[key] = visit(source[key]);
		};

		if ("allOf" in source) {
			append("allOf");
		} else if ("anyOf" in source) {
			append("anyOf");
		} else if (source.type === "object") {
			append("type");
			append("required");
			append("properties");
		} else if (source.type === "array") {
			append("type");
			append("items");
		} else {
			append("type");
			append("const");
		}

		for (const key of strings) {
			if (!(key in result) && !(key === "type" && "allOf" in source)) append(key);
		}
		for (const symbol of Object.getOwnPropertySymbols(source)) {
			result[symbol] = source[symbol];
		}
		return result;
	}

	return visit(schema) as T;
}

export const HopperErrorSchema = Type.Object({
	code: Type.String(),
	message: Type.String(),
	retryable: Type.Boolean(),
	details: Type.Optional(Type.Record(Type.String(), Type.Any())),
});

export const ItemOperationDataSchema = Type.Object({
	items: Type.Array(Type.Object({
		index: Type.Integer({ minimum: 0 }),
		action: Type.String(),
		outcome: Type.Union([
			Type.Literal("succeeded"),
			Type.Literal("failed"),
			Type.Literal("skipped"),
		]),
		targetId: Type.Optional(Type.String()),
		message: Type.String(),
		data: Type.Union([Type.Any(), Type.Null()]),
		error: Type.Union([HopperErrorSchema, Type.Null()]),
	})),
});

export type ItemOperationData = Static<typeof ItemOperationDataSchema> & JsonValue;

export type ActionDescriptor = {
	action: string;
	targetId?: string;
};

export function commandAction(action: string, params: JsonObject): BackendAction {
	return { kind: "command", command: { action, params } };
}

function fallbackError(response: ExecuteActionsResponse): HopperError | null {
	if (response.outcome === "succeeded") return null;
	if (response.error) return response.error;
	return {
		code: response.outcome === "partial"
			? "partial_mutation"
			: response.outcome === "unknown"
				? "outcome_unknown"
				: "operation_failed",
		message: `Backend mutation ${response.outcome}.`,
		retryable: response.outcome === "unknown",
	};
}

function itemDataFromResponse(
	response: ExecuteActionsResponse,
	descriptors: readonly ActionDescriptor[],
): ItemOperationData | null {
	if (
		response.data &&
		!Array.isArray(response.data) &&
		typeof response.data === "object" &&
		Array.isArray(response.data.items)
	) {
		return response.data as ItemOperationData;
	}
	if (
		response.data &&
		!Array.isArray(response.data) &&
		typeof response.data === "object" &&
		Array.isArray(response.data.actions)
	) {
		const actions = response.data.actions;
		if (actions.some((action) => (
			!action
			|| Array.isArray(action)
			|| typeof action !== "object"
			|| !(["succeeded", "failed", "skipped"] as const).includes(action.outcome as never)
		))) {
			return null;
		}
		return {
			items: actions.map((action, actionIndex) => {
				const actionRecord = action as JsonObject;
				const index = typeof actionRecord.index === "number"
					? actionRecord.index
					: actionIndex;
				const descriptor = descriptors[index] ?? descriptors[actionIndex];
				const actionName = descriptor?.action
					?? (typeof actionRecord.action === "string" ? actionRecord.action : undefined)
					?? (typeof actionRecord.kind === "string" ? actionRecord.kind : "action");
				const outcome = actionRecord.outcome as "succeeded" | "failed" | "skipped";
				const itemError = actionRecord.error === null
					? null
					: actionRecord.error && typeof actionRecord.error === "object"
						? actionRecord.error as HopperError
						: outcome === "succeeded" ? null : fallbackError(response);
				return {
					index,
					action: actionName,
					outcome,
					...(descriptor?.targetId ? { targetId: descriptor.targetId } : {}),
					message: typeof actionRecord.message === "string"
						? actionRecord.message
						: `${actionName} ${outcome}.`,
					data: actionRecord.data ?? null,
					error: itemError,
				};
			}),
		};
	}

	const error = fallbackError(response);
	return {
		items: descriptors.map((descriptor, index) => ({
			index,
			action: descriptor.action,
			outcome: response.outcome === "succeeded" ? "succeeded" : "skipped",
			...(descriptor.targetId ? { targetId: descriptor.targetId } : {}),
			message: response.outcome === "succeeded"
				? `${descriptor.action} succeeded.`
				: `${descriptor.action} result unavailable because the mutation ${response.outcome}.`,
			data: null,
			error,
		})),
	};
}

export function finishItemMutation(
	response: ExecuteActionsResponse,
	descriptors: readonly ActionDescriptor[],
): OperationResult<ItemOperationData> {
	const error = fallbackError(response);
	return {
		outcome: response.outcome,
		message: response.outcome === "succeeded"
			? `${descriptors.length} action${descriptors.length === 1 ? "" : "s"} succeeded.`
			: error?.message ?? `Backend mutation ${response.outcome}.`,
		data: response.outcome === "unknown"
			? null
			: itemDataFromResponse(response, descriptors),
		execution: { canvasDigestAfter: response.canvasDigestAfter ?? null },
		warnings: [],
		artifacts: [],
		error,
	};
}

export function preparedItemMutation(
	actions: BackendAction[],
	descriptors: ActionDescriptor[],
): PreparedMutation<ItemOperationData> {
	return {
		scope: "grasshopper",
		actions,
		finish: (response) => finishItemMutation(response, descriptors),
	};
}

export async function executePreparedItemMutation<I extends JsonValue>(
	prepare: (input: I, context: OperationContext) => Promise<PreparedMutation<ItemOperationData>>,
	input: I,
	context: OperationContext,
): Promise<OperationResult<ItemOperationData>> {
	const prepared = await prepare(input, context);
	const response = await context.backend.executeActions(
		{ actions: prepared.actions },
		context.signal,
	);
	return prepared.finish(response);
}
