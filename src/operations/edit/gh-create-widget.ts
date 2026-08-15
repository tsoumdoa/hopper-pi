import { Type, type Static } from "@sinclair/typebox";
import type { JsonObject, JsonValue } from "../../core/contracts.js";
import { defineOperation } from "../../core/operations.js";
import {
	ItemOperationDataSchema,
	PanelCreateFields,
	ScribbleCreateFields,
	SliderCreateFields,
	SwatchFields,
	ToggleFields,
	ValueListCreateFields,
	commandAction,
	executePreparedItemMutation,
	preservePiSchemaJson,
	preparedItemMutation,
} from "./shared.js";

const CreateBase = Type.Object({
	x: Type.Number({ description: "Canvas X position" }),
	y: Type.Number({ description: "Canvas Y position" }),
	nickName: Type.Optional(Type.String()),
});

export const GhCreateWidgetInputSchema = preservePiSchemaJson(Type.Object({
	items: Type.Array(Type.Union([
		Type.Intersect([Type.Object({ widgetType: Type.Literal("slider") }), CreateBase, SliderCreateFields]),
		Type.Intersect([Type.Object({ widgetType: Type.Literal("panel") }), CreateBase, PanelCreateFields]),
		Type.Intersect([Type.Object({ widgetType: Type.Literal("toggle") }), CreateBase, ToggleFields]),
		Type.Intersect([Type.Object({ widgetType: Type.Literal("swatch") }), CreateBase, SwatchFields]),
		Type.Intersect([Type.Object({ widgetType: Type.Literal("scribble") }), CreateBase, ScribbleCreateFields]),
		Type.Intersect([Type.Object({ widgetType: Type.Literal("valueList") }), CreateBase, ValueListCreateFields]),
	]), { minItems: 1 }),
}));

export type GhCreateWidgetInput = Static<typeof GhCreateWidgetInputSchema> & JsonValue;

const actionMap: Record<string, string> = {
	slider: "createSlider",
	panel: "createPanel",
	toggle: "createToggle",
	swatch: "createSwatch",
	scribble: "createScribble",
	valueList: "createValueList",
};

async function prepareMutation(input: GhCreateWidgetInput) {
	const descriptors = input.items.map((item) => ({ action: actionMap[item.widgetType] }));
	const actions = input.items.map((item) => {
		const { widgetType, x, y, nickName, ...fields } = item;
		return commandAction(actionMap[widgetType], {
			position: { x, y },
			...(nickName === undefined ? {} : { nickName }),
			...fields,
		} as JsonObject);
	});
	return preparedItemMutation(actions, descriptors);
}

export const ghCreateWidgetOperation = defineOperation({
	name: "gh_create_widget",
	version: 1,
	description: "Create Grasshopper UI widgets.",
	group: "gh-edit",
	possibleScopes: ["grasshopper"],
	inputSchema: GhCreateWidgetInputSchema,
	outputSchema: ItemOperationDataSchema,
	classifyScope: () => "grasshopper",
	prepareMutation: (input) => prepareMutation(input),
	execute: (input, context) => executePreparedItemMutation(prepareMutation, input, context),
	summarizeInput: (input): JsonObject => ({
		itemCount: input.items.length,
		items: input.items.map((item, index) => ({
			index,
			widgetType: item.widgetType,
			position: { x: item.x, y: item.y },
			hasNickName: item.nickName !== undefined,
		})),
	}),
});
