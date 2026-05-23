import { Type } from "@earendil-works/pi-ai";

export const ParamTypeUnion = Type.Union([
	Type.Literal("object"),
	Type.Literal("double"),
	Type.Literal("int"),
	Type.Literal("string"),
], { description: "Use object for general rhino objects, double for numbers, int for integers, string for strings" });

export const DataMappingType = Type.Union([
	Type.Literal("none"),
	Type.Literal("flatten"),
	Type.Literal("graft"),
], { description: "Data mapping mode" });


export const AccessType = Type.Union([
	Type.Literal("item"),
	Type.Literal("list"),
	Type.Literal("tree"),
], { description: "Access type (default: item)" });

export const SliderCreateFields = Type.Object({
	min: Type.Number({ description: "Minimum value" }),
	max: Type.Number({ description: "Maximum value" }),
	value: Type.Number({ description: "Initial/current value" }),
	digits: Type.Number({ description: "Decimal digits" }),
	interval: Type.Optional(Type.Number({ description: "Step interval (not yet processed by backend)" })),
});

export const SliderSetFields = Type.Object({
	value: Type.Number({ description: "Slider value to set" }),
});

export const SliderRangeFields = Type.Object({
	min: Type.Number({ description: "New minimum value" }),
	max: Type.Number({ description: "New maximum value" }),
	digits: Type.Number({ description: "New decimal digits" }),
	interval: Type.Optional(Type.Number({ description: "New step interval (not yet processed by backend)" })),
});

export const PanelCreateFields = Type.Object({
	text: Type.String({ description: "Panel text content" }),
	width: Type.Optional(Type.Number({ description: "Fixed width in pixels" })),
	height: Type.Optional(Type.Number({ description: "Fixed height in pixels" })),
	multiline: Type.Optional(Type.Boolean({ description: "Enable multiline mode" })),
	bgColor: Type.Optional(Type.String({ description: "Background color as rgba string" })),
});

export const PanelPropertyFields = Type.Object({
	width: Type.Optional(Type.Number({ description: "Fixed width in pixels" })),
	height: Type.Optional(Type.Number({ description: "Fixed height in pixels" })),
	multiline: Type.Optional(Type.Boolean({ description: "Enable multiline mode" })),
	bgColor: Type.Optional(Type.String({ description: "Background color as rgba string" })),
});

export const PanelTextFields = Type.Object({
	text: Type.String({ description: "Panel text content to set" }),
});

export const ToggleFields = Type.Object({
	value: Type.Boolean({ description: "Boolean value" }),
});

export const SwatchFields = Type.Object({
	color: Type.String({ description: "Color as rgba string e.g. 'rgba(255,0,0,255)'" }),
});

export const ScribbleCreateFields = Type.Object({
	text: Type.String({ description: "Scribble text content" }),
	size: Type.Optional(Type.Number({ description: "Font size in points (defaults to 10)" })),
});

export const ScribbleTextFields = Type.Object({
	text: Type.String({ description: "Scribble text content to set" }),
});

export const ValueListItemFields = Type.Object({
	name: Type.String({ description: "Display name for the list item" }),
	value: Type.String({ description: "Value associated with this item" }),
});

export const ValueListCreateFields = Type.Object({
	items: Type.Array(ValueListItemFields),
	selectedIndex: Type.Optional(Type.Number({ description: "0-based index of the initially selected item" })),
});

export const ValueListSelectFields = Type.Object({
	selectedIndex: Type.Number({ description: "0-based index to select" }),
});
