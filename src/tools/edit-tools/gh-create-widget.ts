import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { createExecute } from "../edit-handlers.js";
import { shortenGuidsInText } from "../result-formatters.js";
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
		"Create Grasshopper UI widgets: number sliders, panels, toggles, colour swatches, scribbles, or value lists. " +
		"Use gh_edit_components for standard components and for shared object operations such as moving or deleting a widget.",
	promptSnippet: "Create Grasshopper sliders, panels, toggles, swatches, scribbles, or value lists",
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
			]),
			{ minItems: 1 },
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
			if (result.state === "failed" || result.state === "cancelled") {
				return `create ${i.widgetType} FAILED: ${result.error ?? "unknown error"}`;
			}
			if (result.result) {
				return `create ${i.widgetType} → ${shortenGuidsInText(result.result)}`;
			}
			return `create ${i.widgetType} at (${i.x},${i.y}), jobId=${result.jobId}`;
		},
		(item) => {
			const i = item as typeof item & { x: number; y: number };
			return `creating ${i.widgetType} at (${i.x},${i.y})...`;
		},
	),
});
