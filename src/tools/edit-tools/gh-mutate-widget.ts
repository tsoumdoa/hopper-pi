import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { createExecute } from "../edit-handlers.js";
import { resolveInstanceGuid } from "../../services/guid-shortener.js";
import {
	SliderRangeFields,
	PanelTextFields,
	PanelPropertyFields,
	SwatchFields,
	ValueListSelectFields,
} from "./shared-types.js";
import type { CommandAction } from "../../types/commands.js";

export const ghMutateWidgetTool = defineTool({
	name: "gh_mutate_widget",
	label: "Mutate Widget",
	description: "Surgically change an existing Grasshopper widget's value or widget-specific properties.",
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
				action: Type.Union([
					Type.Literal("setValue"),
					Type.Literal("setRange"),
					Type.Literal("setText"),
					Type.Literal("setProperty"),
					Type.Literal("setColor"),
					Type.Literal("setSelected"),
				]),
				targetId: Type.String(),
				value: Type.Optional(Type.Union([Type.Number(), Type.Boolean()])),
				min: Type.Optional(SliderRangeFields.properties.min),
				max: Type.Optional(SliderRangeFields.properties.max),
				digits: Type.Optional(SliderRangeFields.properties.digits),
				text: Type.Optional(PanelTextFields.properties.text),
				textOutput: Type.Optional(PanelPropertyFields.properties.textOutput),
				width: Type.Optional(PanelPropertyFields.properties.width),
				height: Type.Optional(PanelPropertyFields.properties.height),
				bgColor: Type.Optional(PanelPropertyFields.properties.bgColor),
				color: Type.Optional(SwatchFields.properties.color),
				selectedIndex: Type.Optional(ValueListSelectFields.properties.selectedIndex),
			}),
			{ minItems: 1 },
		),
	}),
	execute: createExecute(
		(item) => {
			const i = item as typeof item & { targetId: string; action: string; widgetType: string };
			const { widgetType, action, targetId, ...fields } = i;
			const key = `${widgetType}:${action}` as const;
			const required: Record<string, string[]> = {
				"slider:setValue": ["value"],
				"slider:setRange": ["min", "max", "digits"],
				"panel:setText": ["text"],
				"panel:setProperty": ["textOutput"],
				"toggle:setValue": ["value"],
				"swatch:setColor": ["color"],
				"scribble:setText": ["text"],
				"valueList:setSelected": ["selectedIndex"],
			};
			const missing = (required[key] ?? []).filter(
				(field) => (item as Record<string, unknown>)[field] == null,
			);
			if (!required[key]) throw new Error(`unsupported widget mutation ${key}`);
			if (missing.length > 0) throw new Error(`${key} requires ${missing.join(", ")}`);
			const actionMap: Record<string, CommandAction> = {
				"slider:setValue": "setSliderValue",
				"slider:setRange": "editSliderRange",
				"panel:setText": "setPanelText",
				"panel:setProperty": "setPanelParams",
				"toggle:setValue": "setToggleValue",
				"swatch:setColor": "setSwatchColor",
				"scribble:setText": "setScribbleText",
				"valueList:setSelected": "setValueListSelected",
			};
			const mapped = actionMap[key];
			return mapped
				? { action: mapped, params: { targetId: resolveInstanceGuid(targetId), ...fields } }
				: null;
		},
		(item) => {
			const i = item as typeof item & { targetId: string; action: string; widgetType: string };
			return `${i.action} ${i.widgetType} on ${i.targetId}...`;
		},
	),
});
