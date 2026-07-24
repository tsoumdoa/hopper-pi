import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { createExecute } from "../edit-handlers.js";
import {
	SliderCreateFields,
	PanelCreateFields,
	SwatchFields,
	ScribbleCreateFields,
	ValueListCreateFields,
} from "./shared-types.js";
import type { CommandAction } from "../../types/commands.js";

export const ghCreateWidgetTool = defineTool({
	name: "gh_create_widget",
	label: "Create Widget",
	description: "Surgically create a Grasshopper slider, panel, toggle, swatch, scribble, or value list.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Object({
				widgetType: Type.Union([
					Type.Literal("slider"),
					Type.Literal("panel"),
					Type.Literal("toggle"),
					Type.Literal("swatch"),
					Type.Literal("scribble"),
					Type.Literal("valueList"),
				]),
				x: Type.Number(),
				y: Type.Number(),
				nickName: Type.Optional(Type.String()),
				min: Type.Optional(SliderCreateFields.properties.min),
				max: Type.Optional(SliderCreateFields.properties.max),
				value: Type.Optional(Type.Union([Type.Number(), Type.Boolean()])),
				digits: Type.Optional(SliderCreateFields.properties.digits),
				text: Type.Optional(Type.String()),
				textOutput: Type.Optional(PanelCreateFields.properties.textOutput),
				width: Type.Optional(PanelCreateFields.properties.width),
				height: Type.Optional(PanelCreateFields.properties.height),
				bgColor: Type.Optional(PanelCreateFields.properties.bgColor),
				color: Type.Optional(SwatchFields.properties.color),
				size: Type.Optional(ScribbleCreateFields.properties.size),
				items: Type.Optional(ValueListCreateFields.properties.items),
				selectedIndex: Type.Optional(ValueListCreateFields.properties.selectedIndex),
			}),
			{ minItems: 1 },
		),
	}),
	execute: createExecute(
		(item) => {
			const { widgetType, x, y, nickName, ...fields } = item;
			const required: Record<string, string[]> = {
				slider: ["min", "max", "value", "digits"],
				panel: ["text", "textOutput"],
				toggle: ["value"],
				swatch: ["color"],
				scribble: ["text"],
				valueList: ["items"],
			};
			const missing = required[widgetType].filter(
				(field) => (item as Record<string, unknown>)[field] == null,
			);
			if (missing.length > 0) {
				throw new Error(`create ${widgetType} requires ${missing.join(", ")}`);
			}
			const actionMap: Record<string, CommandAction> = {
				slider: "createSlider",
				panel: "createPanel",
				toggle: "createToggle",
				swatch: "createSwatch",
				scribble: "createScribble",
				valueList: "createValueList",
			};
			const action = actionMap[widgetType];
			return action
				? { action, params: { position: { x, y }, nickName, ...fields } }
				: null;
		},
		(item) => {
			const i = item as typeof item & { x: number; y: number };
			return `creating ${i.widgetType} at (${i.x},${i.y})...`;
		},
	),
});
