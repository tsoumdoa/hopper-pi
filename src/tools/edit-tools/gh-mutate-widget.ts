import { Type } from "typebox";
import { defineHopperTool as defineTool } from "../../core/tool-contract.js";
import { createExecute, formatDefaultResult } from "../edit-handlers.js";
import { resolveInstanceGuid } from "../../services/guid-shortener.js";
import {
	SliderSetFields,
	SliderRangeFields,
	PanelTextFields,
	PanelPropertyFields,
	ToggleFields,
	SwatchFields,
	ScribbleTextFields,
	ValueListSelectFields,
} from "./shared-types.js";
import type { CommandAction } from "../../types/commands.js";

const MutateBase = Type.Object({
	targetId: Type.String({ description: "Widget GUID" }),
});

export const ghMutateWidgetTool = defineTool({
	name: "gh_mutate_widget",
	label: "Mutate Widget",
	description:
		"Change widget-specific values and properties: slider value/range, panel text/display, toggle, swatch colour, scribble text, or value-list selection. " +
		"Use gh_edit_components to move, rename, hide, lock, or delete widgets.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Union([
				Type.Intersect([
					Type.Object({ widgetType: Type.Literal("slider"), action: Type.Literal("setValue") }),
					MutateBase,
					SliderSetFields,
				]),
				Type.Intersect([
					Type.Object({ widgetType: Type.Literal("slider"), action: Type.Literal("setRange") }),
					MutateBase,
					SliderRangeFields,
				]),
				Type.Intersect([
					Type.Object({ widgetType: Type.Literal("panel"), action: Type.Literal("setText") }),
					MutateBase,
					PanelTextFields,
				]),
				Type.Intersect([
					Type.Object({ widgetType: Type.Literal("panel"), action: Type.Literal("setProperty") }),
					MutateBase,
					PanelPropertyFields,
				]),
				Type.Intersect([
					Type.Object({ widgetType: Type.Literal("toggle"), action: Type.Literal("setValue") }),
					MutateBase,
					ToggleFields,
				]),
				Type.Intersect([
					Type.Object({ widgetType: Type.Literal("swatch"), action: Type.Literal("setColor") }),
					MutateBase,
					SwatchFields,
				]),
				Type.Intersect([
					Type.Object({ widgetType: Type.Literal("scribble"), action: Type.Literal("setText") }),
					MutateBase,
					ScribbleTextFields,
				]),
				Type.Intersect([
					Type.Object({ widgetType: Type.Literal("valueList"), action: Type.Literal("setSelected") }),
					MutateBase,
					ValueListSelectFields,
				]),
			]),
			{ minItems: 1 },
		),
	}),
	execute: createExecute(
		(item) => {
			const i = item as typeof item & { targetId: string; action: string; widgetType: string };
			const { widgetType, action, targetId, ...fields } = i;
			const key = `${widgetType}:${action}` as const;
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
		formatDefaultResult,
		(item) => {
			const i = item as typeof item & { targetId: string; action: string; widgetType: string };
			return `${i.action} ${i.widgetType} on ${i.targetId}...`;
		},
	),
});
