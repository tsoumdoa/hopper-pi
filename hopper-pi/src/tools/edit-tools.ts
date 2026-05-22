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
				hidden: Type.Optional(
					Type.Boolean({ description: "set hidden by default except for Preview functions" })
				),
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
			Type.Union([
				Type.Object({
					action: Type.Literal("listParams"),
					targetId: Type.String({ description: "Component instance GUID (from gh_get_canvas)" }),
				}),
				Type.Object({
					action: Type.Literal("removeInput"),
					targetId: Type.String({ description: "Component instance GUID (from gh_get_canvas)" }),
					name: Type.String({ description: "Parameter name to remove" }),
				}),
				Type.Object({
					action: Type.Literal("removeOutput"),
					targetId: Type.String({ description: "Component instance GUID (from gh_get_canvas)" }),
					name: Type.String({ description: "Parameter name to remove" }),
				}),
				Type.Object({
					action: Type.Literal("addInput"),
					targetId: Type.String({ description: "Component instance GUID (from gh_get_canvas)" }),
					name: Type.String({ description: "Parameter name to add" }),
					paramType: Type.Optional(ParamTypeUnion),
					access: Type.Optional(
						Type.Union([
							Type.Literal("item"),
							Type.Literal("list"),
							Type.Literal("tree"),
						], { description: "Access type for the new input (default: item)" })
					),
					dataMapping: Type.Optional(
						Type.Union([
							Type.Literal("none"),
							Type.Literal("flatten"),
							Type.Literal("graft"),
						], { description: "Data mapping mode for the new input" })
					),
					simplify: Type.Optional(
						Type.Boolean({ description: "Simplify data paths for the new input" })
					),
					reverse: Type.Optional(
						Type.Boolean({ description: "Reverse item order for the new input" })
					),
				}),
				Type.Object({
					action: Type.Literal("addOutput"),
					targetId: Type.String({ description: "Component instance GUID (from gh_get_canvas)" }),
					name: Type.String({ description: "Parameter name to add" }),
					paramType: Type.Optional(ParamTypeUnion),
					dataMapping: Type.Optional(
						Type.Union([
							Type.Literal("none"),
							Type.Literal("flatten"),
							Type.Literal("graft"),
						], { description: "Data mapping mode for the new output" })
					),
					simplify: Type.Optional(
						Type.Boolean({ description: "Simplify data paths for the new output" })
					),
					reverse: Type.Optional(
						Type.Boolean({ description: "Reverse item order for the new output" })
					),
				}),
				Type.Object({
					action: Type.Literal("editAccessType"),
					targetId: Type.String({ description: "Component instance GUID (from gh_get_canvas)" }),
					name: Type.String({ description: "Parameter name" }),
					access: Type.Union([
						Type.Literal("item"),
						Type.Literal("list"),
						Type.Literal("tree"),
					], { description: "Access type to set" }),
				}),
				Type.Object({
					action: Type.Literal("editDataMapping"),
					targetId: Type.String({ description: "Component instance GUID (from gh_get_canvas)" }),
					name: Type.String({ description: "Parameter name" }),
					dataMapping: Type.Optional(
						Type.Union([
							Type.Literal("none"),
							Type.Literal("flatten"),
							Type.Literal("graft"),
						], { description: "Data mapping mode to set" })
					),
					simplify: Type.Optional(
						Type.Boolean({ description: "Simplify data paths" })
					),
					reverse: Type.Optional(
						Type.Boolean({ description: "Reverse item order" })
					),
				}),
			])
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
					return { action: "addScriptInput" as CommandAction, params: { targetId: resolveInstanceGuid(item.targetId), name: item.name, paramType: item.paramType, access: item.access, dataMapping: item.dataMapping, simplify: item.simplify, reverse: item.reverse } };
				case "removeInput":
					return { action: "removeScriptInput" as CommandAction, params: { targetId: resolveInstanceGuid(item.targetId), name: item.name } };
				case "addOutput":
					return { action: "addScriptOutput" as CommandAction, params: { targetId: resolveInstanceGuid(item.targetId), name: item.name, dataMapping: item.dataMapping, simplify: item.simplify, reverse: item.reverse } };
				case "removeOutput":
					return { action: "removeScriptOutput" as CommandAction, params: { targetId: resolveInstanceGuid(item.targetId), name: item.name } };
				case "editAccessType":
					return { action: "editScriptAccess" as CommandAction, params: { targetId: resolveInstanceGuid(item.targetId), name: item.name, access: item.access } };
				case "editDataMapping":
					return {
						action: "editDataMapping" as CommandAction,
						params: {
							targetId: resolveInstanceGuid(item.targetId),
							name: item.name,
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
		(item) => `${item.action} on ${item.targetId} ${'name' in item ? `'${item.name}'` : ""}...`,
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


const SliderCreateFields = Type.Object({
	min: Type.Number({ description: "Minimum value" }),
	max: Type.Number({ description: "Maximum value" }),
	value: Type.Number({ description: "Initial/current value" }),
	digits: Type.Number({ description: "Decimal digits" }),
	interval: Type.Optional(Type.Number({ description: "Step interval (not yet processed by backend)" })),
});

const SliderSetFields = Type.Object({
	value: Type.Number({ description: "Slider value to set" }),
});

const SliderRangeFields = Type.Object({
	min: Type.Number({ description: "New minimum value" }),
	max: Type.Number({ description: "New maximum value" }),
	digits: Type.Number({ description: "New decimal digits" }),
	interval: Type.Optional(Type.Number({ description: "New step interval (not yet processed by backend)" })),
});

const PanelCreateFields = Type.Object({
	text: Type.String({ description: "Panel text content" }),
	width: Type.Optional(Type.Number({ description: "Fixed width in pixels" })),
	height: Type.Optional(Type.Number({ description: "Fixed height in pixels" })),
	multiline: Type.Optional(Type.Boolean({ description: "Enable multiline mode" })),
	bgColor: Type.Optional(Type.String({ description: "Background color as rgba string" })),
});

const PanelPropertyFields = Type.Object({
	width: Type.Optional(Type.Number({ description: "Fixed width in pixels" })),
	height: Type.Optional(Type.Number({ description: "Fixed height in pixels" })),
	multiline: Type.Optional(Type.Boolean({ description: "Enable multiline mode" })),
	bgColor: Type.Optional(Type.String({ description: "Background color as rgba string" })),
});

const PanelTextFields = Type.Object({
	text: Type.String({ description: "Panel text content to set" }),
});

const ToggleFields = Type.Object({
	value: Type.Boolean({ description: "Boolean value" }),
});

const SwatchFields = Type.Object({
	color: Type.String({ description: "Color as rgba string e.g. 'rgba(255,0,0,255)'" }),
});

const ScribbleCreateFields = Type.Object({
	text: Type.String({ description: "Scribble text content" }),
	size: Type.Optional(Type.Number({ description: "Font size in points (defaults to 10)" })),
});

const ScribbleTextFields = Type.Object({
	text: Type.String({ description: "Scribble text content to set" }),
});

const ValueListItemFields = Type.Object({
	name: Type.String({ description: "Display name for the list item" }),
	value: Type.String({ description: "Value associated with this item" }),
});

const ValueListCreateFields = Type.Object({
	items: Type.Array(ValueListItemFields),
	selectedIndex: Type.Optional(Type.Number({ description: "0-based index of the initially selected item" })),
});

const ValueListSelectFields = Type.Object({
	selectedIndex: Type.Number({ description: "0-based index to select" }),
});

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

export const ghEditScriptTool = defineTool({
	name: "gh_edit_script",
	label: "Edit Script",
	description:
		"Perform script node operations on the Grasshopper canvas: create a new C# or Python script node with source code and I/O parameters, or set source code on an existing script. The language is chosen at creation time and cannot be changed afterward. For port management (add/remove inputs/outputs, change access type), use gh_edit_components. Accepts an array of operation items for batch processing.",
	parameters: Type.Object({
		items: Type.Array(
			Type.Union([
				Type.Object({
					action: Type.Literal("create"),
					x: Type.Number({ description: "X position on canvas" }),
					y: Type.Number({ description: "Y position on canvas" }),
					language: Type.Union([
						Type.Literal("python"),
						Type.Literal("csharp"),
					], { description: "Script language — chosen at creation time and cannot be changed afterward" }),
					code: Type.String({ description: "Script source code" }),
					nickName: Type.Optional(
						Type.String({ description: "Script nickname (defaults to language name)" })
					),
					inputs: Type.Optional(
						Type.Array(Type.Object({
							name: Type.String({ description: "Input parameter name" }),
						}), { description: "Input parameters to register at creation time" })
					),
					outputs: Type.Optional(
						Type.Array(Type.Object({
							name: Type.String({ description: "Output parameter name" }),
						}), { description: "Output parameters to register at creation time" })
					),
				}),
				Type.Object({
					action: Type.Literal("setCode"),
					targetId: Type.String({ description: "Script component ID (from gh_get_canvas)" }),
					code: Type.String({ description: "Script source code" }),
				}),
				Type.Object({
					action: Type.Literal("getCode"),
					targetId: Type.String({ description: "Script component ID (from gh_get_canvas)" }),
				}),
			])
		),
	}),
	execute: createHybridExecute(
		"getCode",
		async (item) => {
			if (item.action !== "getCode") return "";
			const response = await withRequester((req) => fetchScriptCode(req, resolveInstanceGuid(item.targetId)));
			const formatted = formatScriptCodeResponse(response);
			return formatted.content[0].text;
		},
		(item) => {
			switch (item.action) {
				case "create":
					return {
						action: "createScriptNode" as CommandAction,
						params: {
							position: { x: item.x, y: item.y },
							language: item.language,
							code: item.code,
							nickName: item.nickName,
							inputs: item.inputs,
							outputs: item.outputs,
						},
					};
				case "setCode":
					return { action: "setScriptCode" as CommandAction, params: { targetId: resolveInstanceGuid(item.targetId), code: item.code } };
				default:
					return null;
			}
		},
		formatDefaultResult,
		(item) => `${item.action} on ${"targetId" in item ? item.targetId : "new script"}...`,
	),
});
