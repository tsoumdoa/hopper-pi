import type { ActionDef } from "../types/commands.js";

export const ACTION_REGISTRY: readonly ActionDef[] = [
	{
		id: 1,
		action: "addComponent",
		label: "add-component",
		params: [
			{ name: "guid", cliFlag: "--componentType <type>", cliDescription: "Component type (addComponent)", prompt: "  component guid: " },
			{ name: "x", cliFlag: "--x <number>", cliDescription: "X position", prompt: "  x position: ", parse: (v) => Number(v) },
			{ name: "y", cliFlag: "--y <number>", cliDescription: "Y position", prompt: "  y position: ", parse: (v) => Number(v) },
		],
	},
	{
		id: 2,
		action: "deleteComponent",
		label: "delete-component",
		params: [
			{ name: "targetId", cliFlag: "--targetId <id>", cliDescription: "Target component ID", prompt: "  target id: " },
		],
	},
	{
		id: 3,
		action: "connectWire",
		label: "connect-wire",
		params: [
			{ name: "fromComponent", cliFlag: "--fromComponent <id>", cliDescription: "Source component ID (wire commands)", prompt: "  from component id: " },
			{ name: "fromPort", cliFlag: "--fromPort <guid>", cliDescription: "Source port GUID (wire commands)", prompt: "  from port guid: " },
			{ name: "toComponent", cliFlag: "--toComponent <id>", cliDescription: "Destination component ID (wire commands)", prompt: "  to component id: " },
			{ name: "toPort", cliFlag: "--toPort <guid>", cliDescription: "Destination port GUID (wire commands)", prompt: "  to port guid: " },
		],
	},
	{
		id: 4,
		action: "disconnectWire",
		label: "disconnect-wire",
		params: [
			{ name: "fromComponent", cliFlag: "--fromComponent <id>", cliDescription: "Source component ID (wire commands)", prompt: "  from component id: " },
			{ name: "fromPort", cliFlag: "--fromPort <guid>", cliDescription: "Source port GUID (wire commands)", prompt: "  from port guid: " },
			{ name: "toComponent", cliFlag: "--toComponent <id>", cliDescription: "Destination component ID (wire commands)", prompt: "  to component id: " },
			{ name: "toPort", cliFlag: "--toPort <guid>", cliDescription: "Destination port GUID (wire commands)", prompt: "  to port guid: " },
		],
	},
	{
		id: 5,
		action: "moveComponent",
		label: "move-component",
		params: [
			{ name: "targetId", cliFlag: "--targetId <id>", cliDescription: "Target component ID", prompt: "  target id: " },
			{ name: "x", cliFlag: "--x <number>", cliDescription: "X position", prompt: "  x position: ", parse: (v) => Number(v) },
			{ name: "y", cliFlag: "--y <number>", cliDescription: "Y position", prompt: "  y position: ", parse: (v) => Number(v) },
		],
	},
	{
		id: 6,
		action: "renameComponent",
		label: "rename-component",
		params: [
			{ name: "targetId", cliFlag: "--targetId <id>", cliDescription: "Target component ID", prompt: "  target id: " },
			{ name: "nickName", cliFlag: "--nickName <name>", cliDescription: "Component nickname", prompt: "  new nickname: " },
		],
	},
	{
		id: 7,
		action: "setComponentLocked",
		label: "set-locked",
		params: [
			{ name: "targetId", cliFlag: "--targetId <id>", cliDescription: "Target component ID", prompt: "  target id: " },
			{ name: "locked", cliFlag: "--locked <boolean>", cliDescription: "Locked state (true/false)", prompt: "  locked (true/false): ", parse: (v) => v === "true" },
		],
	},
	{
		id: 8,
		action: "setComponentHidden",
		label: "set-hidden",
		params: [
			{ name: "targetId", cliFlag: "--targetId <id>", cliDescription: "Target component ID", prompt: "  target id: " },
			{ name: "hidden", cliFlag: "--hidden <boolean>", cliDescription: "Hidden state (true/false)", prompt: "  hidden (true/false): ", parse: (v) => v === "true" },
		],
	},
	{
		id: 9,
		action: "addGroup",
		label: "add-group",
		params: [
			{ name: "componentIds", cliFlag: "--componentIds <ids>", cliDescription: "Component IDs, comma-separated", prompt: "  component ids (comma-separated): ", parse: (v) => v.split(",").map((s) => s.trim()) },
			{ name: "groupName", cliFlag: "--groupName <name>", cliDescription: "Group name", prompt: "  group name: " },
		],
	},
	{
		id: 10,
		action: "removeFromGroup",
		label: "remove-from-group",
		params: [
			{ name: "componentIds", cliFlag: "--componentIds <ids>", cliDescription: "Component IDs, comma-separated", prompt: "  component ids (comma-separated): ", parse: (v) => v.split(",").map((s) => s.trim()) },
			{ name: "groupName", cliFlag: "--groupName <name>", cliDescription: "Group name", prompt: "  group name: " },
		],
	},
	{
		id: 11,
		action: "createSlider",
		label: "create-slider",
		params: [
			{ name: "x", cliFlag: "--x <number>", cliDescription: "X position on canvas", prompt: "  x position: ", parse: (v) => Number(v) },
			{ name: "y", cliFlag: "--y <number>", cliDescription: "Y position on canvas", prompt: "  y position: ", parse: (v) => Number(v) },
			{ name: "nickName", cliFlag: "--nickName <name>", cliDescription: "Slider nickname (optional)", prompt: "  nickname: " },
			{ name: "min", cliFlag: "--min <number>", cliDescription: "Minimum value", prompt: "  min: ", parse: (v) => Number(v) },
			{ name: "max", cliFlag: "--max <number>", cliDescription: "Maximum value", prompt: "  max: ", parse: (v) => Number(v) },
			{ name: "value", cliFlag: "--value <number>", cliDescription: "Initial value", prompt: "  value: ", parse: (v) => Number(v) },
			{ name: "digits", cliFlag: "--digits <int>", cliDescription: "Decimal digits", prompt: "  digits: ", parse: (v) => Number(v) },
			{ name: "interval", cliFlag: "--interval <number>", cliDescription: "Step interval", prompt: "  interval: ", parse: (v) => Number(v) },
		],
	},
	{
		id: 12,
		action: "editSliderRange",
		label: "edit-range",
		params: [
			{ name: "targetId", cliFlag: "--targetId <id>", cliDescription: "Target component ID", prompt: "  target id: " },
			{ name: "min", cliFlag: "--min <number>", cliDescription: "Minimum value", prompt: "  min: ", parse: (v) => Number(v) },
			{ name: "max", cliFlag: "--max <number>", cliDescription: "Maximum value", prompt: "  max: ", parse: (v) => Number(v) },
			{ name: "digits", cliFlag: "--digits <int>", cliDescription: "Decimal digits", prompt: "  digits: ", parse: (v) => Number(v) },
			{ name: "interval", cliFlag: "--interval <number>", cliDescription: "Step interval", prompt: "  interval: ", parse: (v) => Number(v) },
		],
	},
	{
		id: 13,
		action: "setSliderValue",
		label: "set-value",
		params: [
			{ name: "targetId", cliFlag: "--targetId <id>", cliDescription: "Target component ID", prompt: "  target id: " },
			{ name: "value", cliFlag: "--value <number>", cliDescription: "Slider value", prompt: "  value: ", parse: (v) => Number(v) },
		],
	},
	{
		id: 14,
		action: "createPanel",
		label: "create-panel",
		params: [
			{ name: "x", cliFlag: "--x <number>", cliDescription: "X position on canvas", prompt: "  x position: ", parse: (v) => Number(v) },
			{ name: "y", cliFlag: "--y <number>", cliDescription: "Y position on canvas", prompt: "  y position: ", parse: (v) => Number(v) },
			{ name: "nickName", cliFlag: "--nickName <name>", cliDescription: "Panel nickname (optional)", prompt: "  nickname: " },
			{ name: "text", cliFlag: "--text <text>", cliDescription: "Initial panel text", prompt: "  text: " },
			{ name: "width", cliFlag: "--width <number>", cliDescription: "Fixed width in pixels (overrides auto-size)", prompt: "  width: ", parse: (v) => Number(v) },
			{ name: "height", cliFlag: "--height <number>", cliDescription: "Fixed height in pixels (overrides auto-size)", prompt: "  height: ", parse: (v) => Number(v) },
			{ name: "multiline", cliFlag: "--multiline <boolean>", cliDescription: "Enable multiline mode", prompt: "  multiline (true/false): ", parse: (v) => v === "true" },
			{ name: "bgColor", cliFlag: "--bgColor <color>", cliDescription: "Background color rgba e.g. 'rgba(240,248,255,255)'", prompt: "  bg color: " },
		],
	},
	{
		id: 15,
		action: "setPanelParams",
		label: "set-param",
		params: [
			{ name: "targetId", cliFlag: "--targetId <id>", cliDescription: "Target component ID", prompt: "  target id: " },
			{ name: "width", cliFlag: "--width <number>", cliDescription: "Fixed width in pixels (overrides auto-size)", prompt: "  width: ", parse: (v) => Number(v) },
			{ name: "height", cliFlag: "--height <number>", cliDescription: "Fixed height in pixels (overrides auto-size)", prompt: "  height: ", parse: (v) => Number(v) },
			{ name: "multiline", cliFlag: "--multiline <boolean>", cliDescription: "Enable multiline mode", prompt: "  multiline (true/false): ", parse: (v) => v === "true" },
			{ name: "bgColor", cliFlag: "--bgColor <color>", cliDescription: "Background color rgba e.g. 'rgba(240,248,255,255)'", prompt: "  bg color: " },
		],
	},
	{
		id: 16,
		action: "setPanelText",
		label: "set-text",
		params: [
			{ name: "targetId", cliFlag: "--targetId <id>", cliDescription: "Target component ID", prompt: "  target id: " },
			{ name: "text", cliFlag: "--text <text>", cliDescription: "Panel text", prompt: "  text: " },
		],
	},
] as const;
