import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { createExecute, formatDefaultResult } from "../edit-handlers.js";
import {
	SliderCreateFields,
	PanelCreateFields,
	ToggleFields,
	SwatchFields,
	ScribbleCreateFields,
	ValueListCreateFields,
} from "./shared-types.js";
import type { CommandAction } from "../../types/commands.js";

const CreateBase = Type.Object({
	x: Type.Number({ description: "Canvas X position" }),
	y: Type.Number({ description: "Canvas Y position" }),
	nickName: Type.Optional(Type.String()),
});

export const ghCreateWidgetTool = defineTool({
	name: "gh_create_widget",
	label: "Create Widget",
	description:
		"create UI widgets (slider, panel, toggle, swatch, scribble, valueList) at a canvas position.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Union([
				Type.Intersect([
					Type.Object({ widgetType: Type.Literal("slider") }),
					CreateBase,
					SliderCreateFields,
				]),
				Type.Intersect([
					Type.Object({ widgetType: Type.Literal("panel") }),
					CreateBase,
					PanelCreateFields,
				]),
				Type.Intersect([
					Type.Object({ widgetType: Type.Literal("toggle") }),
					CreateBase,
					ToggleFields,
				]),
				Type.Intersect([
					Type.Object({ widgetType: Type.Literal("swatch") }),
					CreateBase,
					SwatchFields,
				]),
				Type.Intersect([
					Type.Object({ widgetType: Type.Literal("scribble") }),
					CreateBase,
					ScribbleCreateFields,
				]),
				Type.Intersect([
					Type.Object({ widgetType: Type.Literal("valueList") }),
					CreateBase,
					ValueListCreateFields,
				]),
			])
		),
	}),
	execute: createExecute(
		(item) => {
			const { widgetType, x, y, nickName, ...fields } = item as typeof item & { x: number; y: number; nickName?: string };
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
		(item, result) => {
			const i = item as typeof item & { x: number; y: number };
			return `create ${i.widgetType} at (${i.x},${i.y}), jobId=${result.jobId}`;
		},
		(item) => {
			const i = item as typeof item & { x: number; y: number };
			return `creating ${i.widgetType} at (${i.x},${i.y})...`;
		},
	),
});
