import { Type, type Static } from "@sinclair/typebox";
import type { JsonObject, JsonValue } from "../../core/contracts.js";
import { defineOperation } from "../../core/operations.js";
import { resolveInstanceGuid } from "../../services/guid-shortener.js";
import {
	ItemOperationDataSchema,
	PanelPropertyFields,
	PanelTextFields,
	ScribbleTextFields,
	SliderRangeFields,
	SliderSetFields,
	SwatchFields,
	ToggleFields,
	ValueListSelectFields,
	commandAction,
	executePreparedItemMutation,
	preservePiSchemaJson,
	preparedItemMutation,
} from "./shared.js";

const MutateBase = Type.Object({
	targetId: Type.String({ description: "Widget GUID" }),
});

export const GhMutateWidgetInputSchema = preservePiSchemaJson(Type.Object({
	items: Type.Array(Type.Union([
		Type.Intersect([Type.Object({ widgetType: Type.Literal("slider"), action: Type.Literal("setValue") }), MutateBase, SliderSetFields]),
		Type.Intersect([Type.Object({ widgetType: Type.Literal("slider"), action: Type.Literal("setRange") }), MutateBase, SliderRangeFields]),
		Type.Intersect([Type.Object({ widgetType: Type.Literal("panel"), action: Type.Literal("setText") }), MutateBase, PanelTextFields]),
		Type.Intersect([Type.Object({ widgetType: Type.Literal("panel"), action: Type.Literal("setProperty") }), MutateBase, PanelPropertyFields]),
		Type.Intersect([Type.Object({ widgetType: Type.Literal("toggle"), action: Type.Literal("setValue") }), MutateBase, ToggleFields]),
		Type.Intersect([Type.Object({ widgetType: Type.Literal("swatch"), action: Type.Literal("setColor") }), MutateBase, SwatchFields]),
		Type.Intersect([Type.Object({ widgetType: Type.Literal("scribble"), action: Type.Literal("setText") }), MutateBase, ScribbleTextFields]),
		Type.Intersect([Type.Object({ widgetType: Type.Literal("valueList"), action: Type.Literal("setSelected") }), MutateBase, ValueListSelectFields]),
	]), { minItems: 1 }),
}));

export type GhMutateWidgetInput = Static<typeof GhMutateWidgetInputSchema> & JsonValue;

const actionMap: Record<string, string> = {
	"slider:setValue": "setSliderValue",
	"slider:setRange": "editSliderRange",
	"panel:setText": "setPanelText",
	"panel:setProperty": "setPanelParams",
	"toggle:setValue": "setToggleValue",
	"swatch:setColor": "setSwatchColor",
	"scribble:setText": "setScribbleText",
	"valueList:setSelected": "setValueListSelected",
};

async function prepareMutation(input: GhMutateWidgetInput) {
	const descriptors = input.items.map((item) => ({
		action: actionMap[`${item.widgetType}:${item.action}`],
		targetId: item.targetId,
	}));
	const actions = input.items.map((item) => {
		const { widgetType, action, targetId, ...fields } = item;
		return commandAction(actionMap[`${widgetType}:${action}`], {
			targetId: resolveInstanceGuid(targetId),
			...fields,
		} as JsonObject);
	});
	return preparedItemMutation(actions, descriptors);
}

export const ghMutateWidgetOperation = defineOperation({
	name: "gh_mutate_widget",
	version: 1,
	description: "Change Grasshopper widget values and properties.",
	group: "gh-edit",
	possibleScopes: ["grasshopper"],
	inputSchema: GhMutateWidgetInputSchema,
	outputSchema: ItemOperationDataSchema,
	classifyScope: () => "grasshopper",
	prepareMutation: (input) => prepareMutation(input),
	execute: (input, context) => executePreparedItemMutation(prepareMutation, input, context),
	summarizeInput: (input): JsonObject => ({
		itemCount: input.items.length,
		items: input.items.map((item, index) => ({
			index,
			widgetType: item.widgetType,
			action: item.action,
			targetId: item.targetId,
		})),
	}),
});
