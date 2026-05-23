import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { createExecute, formatDefaultResult } from "../edit-handlers.js";
import {
	SliderCreateFields,
	SliderSetFields,
	SliderRangeFields,
	PanelCreateFields,
	PanelPropertyFields,
	PanelTextFields,
	ToggleFields,
	SwatchFields,
	ScribbleCreateFields,
	ScribbleTextFields,
	ValueListCreateFields,
	ValueListSelectFields,
} from "./shared-types.js";
import { resolveInstanceGuid } from "../../services/guid-shortener.js";
import type { CommandAction } from "../../types/commands.js";

export const ghEditWidgetTool = defineTool({
	name: "gh_edit_widget",
	label: "Edit Widget",
	description:
		"Unified widget tool for creating and modifying Grasshopper UI widgets: Number Sliders, Panels, Boolean Toggles, Colour Swatches, Scribbles (text annotations), and Value Lists. " +
		"Replaces the individual gh_edit_slider, gh_edit_panel, gh_edit_toggle, gh_edit_swatch, gh_edit_scribble, and gh_edit_value_list tools. " +
		"Use widgetType to specify which kind of widget, and action for the operation. Accepts an array of operation items for batch processing.\n\n" +
		"**Actions per widget type:**\n" +
		"- **slider**: `create` (requires min, max, value, digits; optional interval), `setValue` (requires value), `setRange` (requires min, max, digits; optional interval)\n" +
		"- **panel**: `create` (requires text; optional width/height/multiline/bgColor), `setText` (requires text), `setProperty` (optional width/height/multiline/bgColor)\n" +
		"- **toggle**: `create` (requires value), `setValue` (requires value)\n" +
		"- **swatch**: `create` (requires color), `setColor` (requires color)\n" +
		"- **scribble**: `create` (requires text; optional size), `setText` (requires text)\n" +
		"- **valueList**: `create` (requires items[]; optional selectedIndex), `setSelected` (requires selectedIndex)",
	parameters: Type.Object({
		items: Type.Array(
			Type.Union([
				Type.Intersect([
					Type.Object({
						widgetType: Type.Literal("slider"),
						action: Type.Literal("create"),
						x: Type.Number({ description: "X position on canvas" }),
						y: Type.Number({ description: "Y position on canvas" }),
						nickName: Type.Optional(Type.String({ description: "Widget nickname (defaults to type-specific default)" })),
					}),
					SliderCreateFields,
				]),
				Type.Intersect([
					Type.Object({
						widgetType: Type.Literal("slider"),
						action: Type.Literal("setValue"),
						targetId: Type.String({ description: "Widget instance GUID (from gh_get_canvas)" }),
					}),
					SliderSetFields,
				]),
				Type.Intersect([
					Type.Object({
						widgetType: Type.Literal("slider"),
						action: Type.Literal("setRange"),
						targetId: Type.String({ description: "Widget instance GUID (from gh_get_canvas)" }),
					}),
					SliderRangeFields,
				]),
				Type.Intersect([
					Type.Object({
						widgetType: Type.Literal("panel"),
						action: Type.Literal("create"),
						x: Type.Number({ description: "X position on canvas" }),
						y: Type.Number({ description: "Y position on canvas" }),
						nickName: Type.Optional(Type.String({ description: "Widget nickname (defaults to type-specific default)" })),
					}),
					PanelCreateFields,
				]),
				Type.Intersect([
					Type.Object({
						widgetType: Type.Literal("panel"),
						action: Type.Literal("setText"),
						targetId: Type.String({ description: "Widget instance GUID (from gh_get_canvas)" }),
					}),
					PanelTextFields,
				]),
				Type.Intersect([
					Type.Object({
						widgetType: Type.Literal("panel"),
						action: Type.Literal("setProperty"),
						targetId: Type.String({ description: "Widget instance GUID (from gh_get_canvas)" }),
					}),
					PanelPropertyFields,
				]),
				Type.Intersect([
					Type.Object({
						widgetType: Type.Literal("toggle"),
						action: Type.Literal("create"),
						x: Type.Number({ description: "X position on canvas" }),
						y: Type.Number({ description: "Y position on canvas" }),
						nickName: Type.Optional(Type.String({ description: "Widget nickname (defaults to type-specific default)" })),
					}),
					ToggleFields,
				]),
				Type.Intersect([
					Type.Object({
						widgetType: Type.Literal("toggle"),
						action: Type.Literal("setValue"),
						targetId: Type.String({ description: "Widget instance GUID (from gh_get_canvas)" }),
					}),
					ToggleFields,
				]),
				Type.Intersect([
					Type.Object({
						widgetType: Type.Literal("swatch"),
						action: Type.Literal("create"),
						x: Type.Number({ description: "X position on canvas" }),
						y: Type.Number({ description: "Y position on canvas" }),
						nickName: Type.Optional(Type.String({ description: "Widget nickname (defaults to type-specific default)" })),
					}),
					SwatchFields,
				]),
				Type.Intersect([
					Type.Object({
						widgetType: Type.Literal("swatch"),
						action: Type.Literal("setColor"),
						targetId: Type.String({ description: "Widget instance GUID (from gh_get_canvas)" }),
					}),
					SwatchFields,
				]),
				Type.Intersect([
					Type.Object({
						widgetType: Type.Literal("scribble"),
						action: Type.Literal("create"),
						x: Type.Number({ description: "X position on canvas" }),
						y: Type.Number({ description: "Y position on canvas" }),
						nickName: Type.Optional(Type.String({ description: "Widget nickname (defaults to type-specific default)" })),
					}),
					ScribbleCreateFields,
				]),
				Type.Intersect([
					Type.Object({
						widgetType: Type.Literal("scribble"),
						action: Type.Literal("setText"),
						targetId: Type.String({ description: "Widget instance GUID (from gh_get_canvas)" }),
					}),
					ScribbleTextFields,
				]),
				Type.Intersect([
					Type.Object({
						widgetType: Type.Literal("valueList"),
						action: Type.Literal("create"),
						x: Type.Number({ description: "X position on canvas" }),
						y: Type.Number({ description: "Y position on canvas" }),
						nickName: Type.Optional(Type.String({ description: "Widget nickname (defaults to type-specific default)" })),
					}),
					ValueListCreateFields,
				]),
				Type.Intersect([
					Type.Object({
						widgetType: Type.Literal("valueList"),
						action: Type.Literal("setSelected"),
						targetId: Type.String({ description: "Widget instance GUID (from gh_get_canvas)" }),
					}),
					ValueListSelectFields,
				]),
			])
		),
	}),
	execute: createExecute(
		(item) => {
			switch (item.widgetType) {
				case "slider":
					switch (item.action) {
						case "create": {
							const { widgetType, action, x, y, nickName, ...fields } = item;
							return { action: "createSlider" as CommandAction, params: { position: { x, y }, nickName, ...fields } };
						}
						case "setValue": {
							const { widgetType, action, targetId, ...fields } = item;
							return { action: "setSliderValue" as CommandAction, params: { targetId: resolveInstanceGuid(targetId), ...fields } };
						}
						case "setRange": {
							const { widgetType, action, targetId, ...fields } = item;
							return { action: "editSliderRange" as CommandAction, params: { targetId: resolveInstanceGuid(targetId), ...fields } };
						}
						default:
							return null;
					}
				case "panel":
					switch (item.action) {
						case "create": {
							const { widgetType, action, x, y, nickName, ...fields } = item;
							return { action: "createPanel" as CommandAction, params: { position: { x, y }, nickName, ...fields } };
						}
						case "setText": {
							const { widgetType, action, targetId, ...fields } = item;
							return { action: "setPanelText" as CommandAction, params: { targetId: resolveInstanceGuid(targetId), ...fields } };
						}
						case "setProperty": {
							const { widgetType, action, targetId, ...fields } = item;
							return { action: "setPanelParams" as CommandAction, params: { targetId: resolveInstanceGuid(targetId), ...fields } };
						}
						default:
							return null;
					}
				case "toggle":
					switch (item.action) {
						case "create": {
							const { widgetType, action, x, y, nickName, ...fields } = item;
							return { action: "createToggle" as CommandAction, params: { position: { x, y }, nickName, ...fields } };
						}
						case "setValue": {
							const { widgetType, action, targetId, ...fields } = item;
							return { action: "setToggleValue" as CommandAction, params: { targetId: resolveInstanceGuid(targetId), ...fields } };
						}
						default:
							return null;
					}
				case "swatch":
					switch (item.action) {
						case "create": {
							const { widgetType, action, x, y, nickName, ...fields } = item;
							return { action: "createSwatch" as CommandAction, params: { position: { x, y }, nickName, ...fields } };
						}
						case "setColor": {
							const { widgetType, action, targetId, ...fields } = item;
							return { action: "setSwatchColor" as CommandAction, params: { targetId: resolveInstanceGuid(targetId), ...fields } };
						}
						default:
							return null;
					}
				case "scribble":
					switch (item.action) {
						case "create": {
							const { widgetType, action, x, y, nickName, ...fields } = item;
							return { action: "createScribble" as CommandAction, params: { position: { x, y }, nickName, ...fields } };
						}
						case "setText": {
							const { widgetType, action, targetId, ...fields } = item;
							return { action: "setScribbleText" as CommandAction, params: { targetId: resolveInstanceGuid(targetId), ...fields } };
						}
						default:
							return null;
					}
				case "valueList":
					switch (item.action) {
						case "create": {
							const { widgetType, action, x, y, nickName, ...fields } = item;
							return { action: "createValueList" as CommandAction, params: { position: { x, y }, nickName, ...fields } };
						}
						case "setSelected": {
							const { widgetType, action, targetId, ...fields } = item;
							return { action: "setValueListSelected" as CommandAction, params: { targetId: resolveInstanceGuid(targetId), ...fields } };
						}
						default:
							return null;
					}
				default:
					return null;
			}
		},
		formatDefaultResult,
		(item) => `${item.action} ${item.widgetType} on ${"targetId" in item ? item.targetId : "new"}...`,
	),
});