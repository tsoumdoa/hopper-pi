import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { createExecute, formatDefaultResult, defaultProgressMsg, createHybridExecute } from "./edit-handlers.js";
import { withRequester } from "../infra/request-helpers.js";
import { fetchScriptParams, fetchScriptCode, formatScriptParamsResponse, formatScriptCodeResponse } from "./query-handlers.js";
import type { CommandAction } from "../types/commands.js";
import {
	resolveInstanceGuid,
	resolveTypeGuid,
} from "../services/guid-shortener.js";

const ParamTypeUnion = Type.Union([
	Type.Literal("GH_ProxyParameter"),
	Type.Literal("GH_Receiver"),
	Type.Literal("Param_AngularDimension"),
	Type.Literal("Param_Arc"),
	Type.Literal("Param_Boolean"),
	Type.Literal("Param_Box"),
	Type.Literal("Param_Brep"),
	Type.Literal("Param_Centermark"),
	Type.Literal("Param_Circle"),
	Type.Literal("Param_Colour"),
	Type.Literal("Param_Complex"),
	Type.Literal("Param_Culture"),
	Type.Literal("Param_Curve"),
	Type.Literal("Param_Extrusion"),
	Type.Literal("Param_Field"),
	Type.Literal("Param_FilePath"),
	Type.Literal("Param_GenericObject"),
	Type.Literal("Param_Geometry"),
	Type.Literal("Param_Group"),
	Type.Literal("Param_Guid"),
	Type.Literal("Param_Hatch"),
	Type.Literal("Param_InstanceReference"),
	Type.Literal("Param_Integer"),
	Type.Literal("Param_Interval"),
	Type.Literal("Param_Interval2D"),
	Type.Literal("Param_Interval2D_OBSOLETE"),
	Type.Literal("Param_LatLonLocation"),
	Type.Literal("Param_Leader"),
	Type.Literal("Param_Light"),
	Type.Literal("Param_Line"),
	Type.Literal("Param_LinearDimension"),
	Type.Literal("Param_Matrix"),
	Type.Literal("Param_Mesh"),
	Type.Literal("Param_MeshFace"),
	Type.Literal("Param_MeshParameters"),
	Type.Literal("Param_Number"),
	Type.Literal("Param_OGLShader"),
	Type.Literal("Param_OrdinateDimension"),
	Type.Literal("Param_Plane"),
	Type.Literal("Param_Point"),
	Type.Literal("Param_PointCloud"),
	Type.Literal("Param_Predicate"),
	Type.Literal("Param_RadialDimension"),
	Type.Literal("Param_Rectangle"),
	Type.Literal("Param_ScriptVariable"),
	Type.Literal("Param_String"),
	Type.Literal("Param_StructurePath"),
	Type.Literal("Param_SubD"),
	Type.Literal("Param_Surface"),
	Type.Literal("Param_TextDot"),
	Type.Literal("Param_TextEntity"),
	Type.Literal("Param_Time"),
	Type.Literal("Param_Transform"),
	Type.Literal("Param_Vector"),
], { description: "Specific GH param type for the input — optional for addInput (defaults to script component's default parameter type)" });

export const ghEditComponentsTool = defineTool({
	name: "gh_edit_components",
	label: "Edit Components",
	description:
		"Perform component operations on the Grasshopper canvas: add, delete, move, rename, set_locked, or set_hidden. Use gh_get_canvas first to get instance GUIDs for existing components. Use gh_list_components to find type GUIDs for adding new components. Accepts an array of operation items for batch processing.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Object({
				action: Type.Union([
					Type.Literal("add"),
					Type.Literal("delete"),
					Type.Literal("move"),
					Type.Literal("rename"),
					Type.Literal("set_locked"),
					Type.Literal("set_hidden"),
				]),
				targetId: Type.Optional(
					Type.String({ description: "Component instance GUID (from gh_get_canvas) — required for delete/move/rename/set_locked/set_hidden" })
				),
				componentType: Type.Optional(
					Type.String({ description: "Component type GUID (from gh_list_components) — required for add" })
				),
				x: Type.Optional(
					Type.Number({ description: "X position on canvas — required for add/move - must be greater than 20" })
				),
				y: Type.Optional(
					Type.Number({ description: "Y position on canvas — required for add/move - must be greater than 20" })
				),
				nickName: Type.Optional(
					Type.String({ description: "Nickname — optional for add, required for rename" })
				),
				locked: Type.Optional(
					Type.Boolean({ description: "true to lock, false to unlock — required for set_locked" })
				),
				hidden: Type.Boolean({ description: "set hidden by default except for Preview functions" }),
			})
		),
	}),
	execute: createExecute(
		(item) => {
			switch (item.action) {
				case "add":
					return {
						action: "addComponent" as CommandAction,
						params: {
							typeGuid: resolveTypeGuid(item.componentType!),
							position: { x: item.x!, y: item.y! },
							nickName: item.nickName,
						},
					};
				case "delete":
					return { action: "deleteComponent", params: { targetId: resolveInstanceGuid(item.targetId!) } };
				case "move":
					return {
						action: "moveComponent",
						params: { targetId: resolveInstanceGuid(item.targetId!), position: { x: item.x!, y: item.y! } },
					};
				case "rename":
					return {
						action: "renameComponent",
						params: { targetId: resolveInstanceGuid(item.targetId!), nickName: item.nickName },
					};
				case "set_locked":
					return {
						action: "setComponentLocked",
						params: { targetId: resolveInstanceGuid(item.targetId!), locked: item.locked },
					};
				case "set_hidden":
					return {
						action: "setComponentHidden",
						params: { targetId: resolveInstanceGuid(item.targetId!), hidden: item.hidden },
					};
				default:
					return null;
			}
		},
		(item, result) => {
			if (item.action === "add") {
				return `${item.action} completed. type=${item.componentType}, jobId=${result.jobId}`;
			}
			return formatDefaultResult(item, result);
		},
		defaultProgressMsg,
	),
});

export const ghEditParamTool = defineTool({
	name: "gh_edit_param",
	label: "Edit Params",
	description:
		"Manage input/output ports on Grasshopper components that support variable parameters (e.g. script components): add or remove input/output parameters, change access type (item/list/tree), change data mapping (flatten/graft/simplify/reverse), or list current parameter names with their access and mapping state. For addInput, you can optionally specify a paramType (e.g. Param_Number, Param_String, Param_Point, Param_Boolean, etc.) to control the parameter type. Accepts an array of operation items for batch processing.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Object({
				action: Type.Union([
					Type.Literal("addInput"),
					Type.Literal("removeInput"),
					Type.Literal("addOutput"),
					Type.Literal("removeOutput"),
					Type.Literal("editAccessType"),
					Type.Literal("listParams"),
					Type.Literal("editDataMapping"),
				]),
				targetId: Type.String({ description: "Component instance GUID (from gh_get_canvas) — required for all actions" }),
				name: Type.Optional(
					Type.String({ description: "Parameter name — required for addInput, removeInput, addOutput, removeOutput, editAccessType, editDataMapping" })
				),
				paramType: Type.Optional(ParamTypeUnion),
				access: Type.Optional(
					Type.Union([
						Type.Literal("item"),
						Type.Literal("list"),
						Type.Literal("tree"),
					], { description: "Access type — required for editAccessType (Python only)" })
				),
				dataMapping: Type.Optional(
					Type.Union([
						Type.Literal("none"),
						Type.Literal("flatten"),
						Type.Literal("graft"),
					], { description: "Data mapping mode — optional for editDataMapping" })
				),
				simplify: Type.Optional(
					Type.Boolean({ description: "Simplify data paths — optional for editDataMapping" })
				),
				reverse: Type.Optional(
					Type.Boolean({ description: "Reverse item order — optional for editDataMapping" })
				),
			})
		),
	}),
	execute: createHybridExecute(
		"listParams",
		async (item) => {
			const response = await withRequester((req) => fetchScriptParams(req, resolveInstanceGuid(item.targetId)));
			const formatted = formatScriptParamsResponse(response);
			return formatted.content[0].text;
		},
		(item) => {
			switch (item.action) {
				case "addInput":
					return { action: "addScriptInput" as CommandAction, params: { targetId: resolveInstanceGuid(item.targetId), name: item.name!, paramType: item.paramType } };
				case "removeInput":
					return { action: "removeScriptInput" as CommandAction, params: { targetId: resolveInstanceGuid(item.targetId), name: item.name! } };
				case "addOutput":
					return { action: "addScriptOutput" as CommandAction, params: { targetId: resolveInstanceGuid(item.targetId), name: item.name! } };
				case "removeOutput":
					return { action: "removeScriptOutput" as CommandAction, params: { targetId: resolveInstanceGuid(item.targetId), name: item.name! } };
				case "editAccessType":
					return { action: "editScriptAccess" as CommandAction, params: { targetId: resolveInstanceGuid(item.targetId), name: item.name!, access: item.access! } };
				case "editDataMapping":
					return {
						action: "editDataMapping" as CommandAction,
						params: {
							targetId: resolveInstanceGuid(item.targetId),
							name: item.name!,
							dataMapping: item.dataMapping,
							simplify: item.simplify,
							reverse: item.reverse,
						},
					};
				default:
					return null;
			}
		},
		formatDefaultResult,
		(item) => `${item.action} on ${item.targetId} ${item.name ? `'${item.name}'` : ""}...`,
	),
});

export const ghEditWireTool = defineTool({
	name: "gh_edit_wire",
	label: "Edit Wire",
	description:
		"Connect or disconnect wires between component ports using 4 GUID aliases copied from gh_get_canvas: source COMPONENT_GUID, source output PORT_GUID, target COMPONENT_GUID, target input PORT_GUID. Full GUIDs also work. Do not use names, nicknames, [id] values, or port labels. Accepts an array of wire definitions for batch processing.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Object({
				action: Type.Union([
					Type.Literal("connect"),
					Type.Literal("disconnect"),
				]),
				fromComponent: Type.String({
					description: "Copy the COMPONENT_GUID= value from the SOURCE component's header row in gh_get_canvas output.",
				}),
				fromPort: Type.String({
					description: "Copy the PORT_GUID= value from the SOURCE component's OUTPUTS section in gh_get_canvas output.",
				}),
				toComponent: Type.String({
					description: "Copy the COMPONENT_GUID= value from the TARGET component's header row in gh_get_canvas output.",
				}),
				toPort: Type.String({
					description: "Copy the PORT_GUID= value from the TARGET component's INPUTS section in gh_get_canvas output.",
				}),
			})
		),
	}),
	execute: createExecute(
		(item) => ({
			action: item.action === "connect" ? ("connectWire" as CommandAction) : ("disconnectWire" as CommandAction),
			params: {
				from: { componentId: resolveInstanceGuid(item.fromComponent), port: resolveInstanceGuid(item.fromPort) },
				to: { componentId: resolveInstanceGuid(item.toComponent), port: resolveInstanceGuid(item.toPort) },
			},
		}),
		(item, result) => {
			const resolvedFromComp = resolveInstanceGuid(item.fromComponent);
			const resolvedFromPort = resolveInstanceGuid(item.fromPort);
			const resolvedToComp = resolveInstanceGuid(item.toComponent);
			const resolvedToPort = resolveInstanceGuid(item.toPort);
			return `Wire ${item.action === "connect" ? "connected" : "disconnected"}. ` +
				`from=${item.fromComponent}->${resolvedFromComp}:${item.fromPort}->${resolvedFromPort} ` +
				`to=${item.toComponent}->${resolvedToComp}:${item.toPort}->${resolvedToPort}, jobId=${result.jobId}`;
		},
		(item) => `${item.action === "connect" ? "Connecting" : "Disconnecting"} wire ${item.fromComponent}:${item.fromPort} → ${item.toComponent}:${item.toPort}...`,
	),
});

export const ghEditGroupTool = defineTool({
	name: "gh_edit_group",
	label: "Edit Group",
	description:
		"Perform group operations on Grasshopper canvas: add, remove from, delete, change color, rename, or change style (color/name/border). Accepts an array of operation items for batch processing. The 'border' field (Box/Blob/Rectangles) only applies to 'add' and 'changeStyle' operations.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Object({
				operation: Type.Union([
					Type.Literal("add"),
					Type.Literal("remove"),
					Type.Literal("delete"),
					Type.Literal("changeColor"),
					Type.Literal("rename"),
					Type.Literal("changeStyle"),
				]),
				componentIds: Type.Optional(
					Type.String({ description: "Comma-separated component IDs (for add/remove)" })
				),
				groupName: Type.Optional(
					Type.String({ description: "Name of the target group" })
				),
				color: Type.Optional(
					Type.String({ description: "Group color as rgba string (default rgba(255,255,255,150)) - alpha should always be 150 unless instructed otherwise. Used by add, changeColor, changeStyle" })
				),
				name: Type.Optional(
					Type.String({ description: "Name for the group (for add/rename) or new title (for changeStyle)" })
				),
				border: Type.Optional(
					Type.Union([
						Type.Literal("Box"),
						Type.Literal("Blob"),
						Type.Literal("Rectangles"),
					])
				),
			})
		),
	}),
	execute: createExecute(
		(item) => {
			switch (item.operation) {
				case "add":
					return {
						action: "addGroup",
						params: {
							componentIds: item.componentIds?.split(",")?.map((s) => s.trim()).map((s) => resolveInstanceGuid(s)),
							groupName: item.groupName,
							color: item.color ?? "rgba(255,255,255,150)",
							border: item.border,
						},
					};
				case "remove":
					return {
						action: "removeFromGroup",
						params: {
							componentIds: item.componentIds?.split(",")?.map((s) => s.trim()).map((s) => resolveInstanceGuid(s)),
							groupName: item.groupName,
						},
					};
				case "delete":
					return { action: "deleteGroup", params: { groupName: item.groupName } };
				case "changeColor":
					return { action: "changeGroupColor", params: { groupName: item.groupName, color: item.color ?? "rgba(255,255,255,150)" } };
				case "rename":
					return { action: "renameGroup", params: { groupName: item.groupName, name: item.name } };
				case "changeStyle":
					return { action: "changeGroupStyle", params: { groupName: item.groupName, color: item.color, name: item.name, border: item.border } };
				default:
					return null;
			}
		},
		(item, result) => {
			const rawIds = item.componentIds ?? "N/A";
			const resolved = rawIds === "N/A" ? "N/A" : rawIds.split(",").map((s) => resolveInstanceGuid(s.trim())).join(",");
			return `${item.operation} on "${item.groupName}". shortIds=${rawIds} -> resolvedGuids=[${resolved}], jobId=${result.jobId}`;
		},
		(item) => `${item.operation} on group "${item.groupName}"...`,
	),
});

export const ghEditSliderTool = defineTool({
	name: "gh_edit_slider",
	label: "Edit Slider",
	description:
		"Perform slider operations on the Grasshopper canvas: create a new Number Slider with full configuration, edit the range/digits of an existing slider, or set the current value. Accepts an array of operation items for batch processing.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Object({
				action: Type.Union([
					Type.Literal("createSlider"),
					Type.Literal("editRange"),
					Type.Literal("setValue"),
				]),
				targetId: Type.Optional(
					Type.String({ description: "Slider component ID (from gh_get_canvas) — required for editRange and setValue" })
				),
				x: Type.Optional(
					Type.Number({ description: "X position on canvas — required for createSlider" })
				),
				y: Type.Optional(
					Type.Number({ description: "Y position on canvas — required for createSlider" })
				),
				nickName: Type.Optional(
					Type.String({ description: "Slider nickname — optional for createSlider (defaults to 'Number Slider')" })
				),
				min: Type.Optional(
					Type.Number({ description: "Minimum value — required for createSlider and editRange" })
				),
				max: Type.Optional(
					Type.Number({ description: "Maximum value — required for createSlider and editRange" })
				),
				value: Type.Optional(
					Type.Number({ description: "Slider value — required for createSlider and setValue" })
				),
				digits: Type.Optional(
					Type.Number({ description: "Decimal digits — required for createSlider and editRange" })
				),
				interval: Type.Optional(
					Type.Number({ description: "Step interval — required for createSlider and editRange" })
				),
			})
		),
	}),
	execute: createExecute(
		(item) => {
			switch (item.action) {
				case "createSlider":
					return {
						action: "createSlider",
						params: {
							position: { x: item.x!, y: item.y! },
							nickName: item.nickName,
							min: item.min!,
							max: item.max!,
							value: item.value!,
							digits: item.digits!,
							interval: item.interval!,
						},
					};
				case "editRange":
					return {
						action: "editSliderRange",
						params: {
							targetId: resolveInstanceGuid(item.targetId!),
							min: item.min!,
							max: item.max!,
							digits: item.digits!,
							interval: item.interval!,
						},
					};
				case "setValue":
					return { action: "setSliderValue", params: { targetId: resolveInstanceGuid(item.targetId!), value: item.value! } };
				default:
					return null;
			}
		},
		formatDefaultResult,
		(item) => `${item.action} on ${item.targetId ?? "new slider"}...`,
	),
});

export const ghEditPanelTool = defineTool({
	name: "gh_edit_panel",
	label: "Edit Panel",
	description:
		"Perform panel operations on the Grasshopper canvas: create a new Panel with initial text and visual properties, edit visual properties of an existing panel (width, height, multiline mode, background color), or set the text content. Accepts an array of operation items for batch processing.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Object({
				action: Type.Union([
					Type.Literal("createPanel"),
					Type.Literal("setParam"),
					Type.Literal("setText"),
				]),
				targetId: Type.Optional(
					Type.String({ description: "Panel component ID (from gh_get_canvas) — required for setParam and setText" })
				),
				x: Type.Optional(
					Type.Number({ description: "X position on canvas — required for createPanel" })
				),
				y: Type.Optional(
					Type.Number({ description: "Y position on canvas — required for createPanel" })
				),
				text: Type.Optional(
					Type.String({ description: "Panel text content — required for createPanel and setText" })
				),
				nickName: Type.Optional(
					Type.String({ description: "Panel nickname — optional for createPanel (defaults to 'Panel')" })
				),
				width: Type.Optional(
					Type.Number({ description: "Panel fixed width in pixels — overrides auto-size; use with createPanel or setParam" })
				),
				height: Type.Optional(
					Type.Number({ description: "Panel fixed height in pixels — overrides auto-size; use with createPanel or setParam" })
				),
				multiline: Type.Optional(
					Type.Boolean({ description: "Enable multiline text mode — use with createPanel or setParam" })
				),
				bgColor: Type.Optional(
					Type.String({ description: "Background color as rgba string e.g. 'rgba(255,255,255,255)' — use with createPanel or setParam" })
				),
			})
		),
	}),
	execute: createExecute(
		(item) => {
			switch (item.action) {
				case "createPanel":
					return {
						action: "createPanel",
						params: {
							position: { x: item.x!, y: item.y! },
							nickName: item.nickName,
							text: item.text!,
							width: item.width,
							height: item.height,
							multiline: item.multiline,
							bgColor: item.bgColor,
						},
					};
				case "setParam":
					return {
						action: "setPanelParams",
						params: {
							targetId: resolveInstanceGuid(item.targetId!),
							width: item.width,
							height: item.height,
							multiline: item.multiline,
							bgColor: item.bgColor,
						},
					};
				case "setText":
					return { action: "setPanelText", params: { targetId: resolveInstanceGuid(item.targetId!), text: item.text! } };
				default:
					return null;
			}
		},
		formatDefaultResult,
		(item) => `${item.action} on ${item.targetId ?? "new panel"}...`,
	),
});

export const ghEditToggleTool = defineTool({
	name: "gh_edit_toggle",
	label: "Edit Toggle",
	description:
		"Perform toggle (boolean) operations on the Grasshopper canvas: create a new Boolean Toggle with initial value, or set the value of an existing toggle. Accepts an array of operation items for batch processing.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Object({
				action: Type.Union([
					Type.Literal("createToggle"),
					Type.Literal("setToggleValue"),
				]),
				targetId: Type.Optional(
					Type.String({ description: "Toggle component ID (from gh_get_canvas) — required for setToggleValue" })
				),
				x: Type.Optional(
					Type.Number({ description: "X position on canvas — required for createToggle" })
				),
				y: Type.Optional(
					Type.Number({ description: "Y position on canvas — required for createToggle" })
				),
				nickName: Type.Optional(
					Type.String({ description: "Toggle nickname — optional for createToggle (defaults to 'Toggle')" })
				),
				value: Type.Optional(
					Type.Boolean({ description: "Boolean value — required for createToggle and setToggleValue" })
				),
			})
		),
	}),
	execute: createExecute(
		(item) => {
			switch (item.action) {
				case "createToggle":
					return {
						action: "createToggle",
						params: { position: { x: item.x!, y: item.y! }, nickName: item.nickName, value: item.value! },
					};
				case "setToggleValue":
					return { action: "setToggleValue", params: { targetId: resolveInstanceGuid(item.targetId!), value: item.value! } };
				default:
					return null;
			}
		},
		formatDefaultResult,
		(item) => `${item.action} on ${item.targetId ?? "new toggle"}...`,
	),
});

export const ghEditSwatchTool = defineTool({
	name: "gh_edit_swatch",
	label: "Edit Swatch",
	description:
		"Perform colour swatch operations on the Grasshopper canvas: create a new Colour Swatch with an rgba color, or change the color of an existing swatch. Accepts an array of operation items for batch processing.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Object({
				action: Type.Union([
					Type.Literal("createSwatch"),
					Type.Literal("setSwatchColor"),
				]),
				targetId: Type.Optional(
					Type.String({ description: "Swatch component ID (from gh_get_canvas) — required for setSwatchColor" })
				),
				x: Type.Optional(
					Type.Number({ description: "X position on canvas — required for createSwatch" })
				),
				y: Type.Optional(
					Type.Number({ description: "Y position on canvas — required for createSwatch" })
				),
				nickName: Type.Optional(
					Type.String({ description: "Swatch nickname — optional for createSwatch (defaults to 'Swatch')" })
				),
				color: Type.Optional(
					Type.String({ description: "Color as rgba string e.g. 'rgba(255,0,0,255)' — required for createSwatch and setSwatchColor" })
				),
			})
		),
	}),
	execute: createExecute(
		(item) => {
			switch (item.action) {
				case "createSwatch":
					return {
						action: "createSwatch",
						params: { position: { x: item.x!, y: item.y! }, nickName: item.nickName, color: item.color! },
					};
				case "setSwatchColor":
					return { action: "setSwatchColor", params: { targetId: resolveInstanceGuid(item.targetId!), color: item.color! } };
				default:
					return null;
			}
		},
		formatDefaultResult,
		(item) => `${item.action} on ${item.targetId ?? "new swatch"}...`,
	),
});

export const ghEditScribbleTool = defineTool({
	name: "gh_edit_scribble",
	label: "Edit Scribble",
	description:
		"Perform scribble (text annotation) operations on the Grasshopper canvas: create a new Scribble with text, or set the text of an existing scribble. Accepts an array of operation items for batch processing.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Object({
				action: Type.Union([
					Type.Literal("createScribble"),
					Type.Literal("setScribbleText"),
				]),
				targetId: Type.Optional(
					Type.String({ description: "Scribble component ID (from gh_get_canvas) — required for setScribbleText" })
				),
				x: Type.Optional(
					Type.Number({ description: "X position on canvas — required for createScribble" })
				),
				y: Type.Optional(
					Type.Number({ description: "Y position on canvas — required for createScribble" })
				),
				text: Type.Optional(
					Type.String({ description: "Scribble text content — required for createScribble and setScribbleText" })
				),
				nickName: Type.Optional(
					Type.String({ description: "Scribble nickname — optional for createScribble (defaults to 'Scribble')" })
				),
				size: Type.Optional(
					Type.Number({ description: "Font size in points — optional for createScribble (defaults to 10)" })
				),
			})
		),
	}),
	execute: createExecute(
		(item) => {
			switch (item.action) {
				case "createScribble":
					return {
						action: "createScribble",
						params: { position: { x: item.x!, y: item.y! }, nickName: item.nickName, text: item.text!, size: item.size },
					};
				case "setScribbleText":
					return { action: "setScribbleText", params: { targetId: resolveInstanceGuid(item.targetId!), text: item.text! } };
				default:
					return null;
			}
		},
		formatDefaultResult,
		(item) => `${item.action} on ${item.targetId ?? "new scribble"}...`,
	),
});

export const ghEditValueListTool = defineTool({
	name: "gh_edit_value_list",
	label: "Edit Value List",
	description:
		"Perform value list operations on the Grasshopper canvas: create a new Value List with items (name/value pairs) and optional selected index, or change the selected item of an existing value list. Accepts an array of operation items for batch processing.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Object({
				action: Type.Union([
					Type.Literal("createValueList"),
					Type.Literal("setValueListSelected"),
				]),
				targetId: Type.Optional(
					Type.String({ description: "Value List component ID (from gh_get_canvas) — required for setValueListSelected" })
				),
				x: Type.Optional(
					Type.Number({ description: "X position on canvas — required for createValueList" })
				),
				y: Type.Optional(
					Type.Number({ description: "Y position on canvas — required for createValueList" })
				),
				nickName: Type.Optional(
					Type.String({ description: "Value List nickname — optional for createValueList (defaults to 'Value List')" })
				),
				items: Type.Optional(
					Type.Array(Type.Object({
						name: Type.String({ description: "Display name for the list item" }),
						value: Type.String({ description: "Value associated with this item" }),
					}))
				),
				selectedIndex: Type.Optional(
					Type.Number({ description: "0-based index of the initially selected item — optional for createValueList" })
				),
			})
		),
	}),
	execute: createExecute(
		(item) => {
			switch (item.action) {
				case "createValueList":
					return {
						action: "createValueList",
						params: {
							position: { x: item.x!, y: item.y! },
							nickName: item.nickName,
							items: item.items,
							selectedIndex: item.selectedIndex,
						},
					};
				case "setValueListSelected":
					return { action: "setValueListSelected", params: { targetId: resolveInstanceGuid(item.targetId!), selectedIndex: item.selectedIndex! } };
				default:
					return null;
			}
		},
		formatDefaultResult,
		(item) => `${item.action} on ${item.targetId ?? "new value list"}...`,
	),
});

export const ghEditScriptTool = defineTool({
	name: "gh_edit_script",
	label: "Edit Script",
	description:
		"Perform script node operations on the Grasshopper canvas: create a new C# or Python script node with source code and I/O parameters, or set source code on an existing script. The language is chosen at creation time and cannot be changed afterward. For port management (add/remove inputs/outputs, change access type), use gh_edit_components. Accepts an array of operation items for batch processing.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Object({
				action: Type.Union([
					Type.Literal("create"),
					Type.Literal("setCode"),
					Type.Literal("getCode"),
				]),
				targetId: Type.Optional(
					Type.String({ description: "Script component ID (from gh_get_canvas) — required for setCode and getCode" })
				),
				x: Type.Optional(
					Type.Number({ description: "X position on canvas — required for create" })
				),
				y: Type.Optional(
					Type.Number({ description: "Y position on canvas — required for create" })
				),
				language: Type.Optional(
					Type.Union([
						Type.Literal("python"),
						Type.Literal("csharp"),
					])
				),
				code: Type.Optional(
					Type.String({ description: "Script source code — required for create and setCode" })
				),
				nickName: Type.Optional(
					Type.String({ description: "Script nickname — optional for create (defaults to language name)" })
				),
				inputs: Type.Optional(
					Type.Array(Type.Object({
						name: Type.String({ description: "Input parameter name" }),
					}), { description: "Input parameters to register at creation time — optional for create" })
				),
				outputs: Type.Optional(
					Type.Array(Type.Object({
						name: Type.String({ description: "Output parameter name" }),
					}), { description: "Output parameters to register at creation time — optional for create" })
				),
			})
		),
	}),
	execute: createHybridExecute(
		"getCode",
		async (item) => {
			const response = await withRequester((req) => fetchScriptCode(req, resolveInstanceGuid(item.targetId!)));
			const formatted = formatScriptCodeResponse(response);
			return formatted.content[0].text;
		},
		(item) => {
			switch (item.action) {
				case "create":
					return {
						action: "createScriptNode" as CommandAction,
						params: {
							position: { x: item.x!, y: item.y! },
							language: item.language ?? "csharp",
							code: item.code ?? "",
							nickName: item.nickName,
							inputs: item.inputs,
							outputs: item.outputs,
						},
					};
				case "setCode":
					return { action: "setScriptCode" as CommandAction, params: { targetId: resolveInstanceGuid(item.targetId!), code: item.code! } };
				default:
					return null;
			}
		},
		formatDefaultResult,
		(item) => `${item.action} on ${item.targetId ?? "new script"}...`,
	),
});
