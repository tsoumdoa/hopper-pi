import { Type } from "@earendil-works/pi-ai";

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

export const TypeHintType = Type.Union([
	Type.Literal("object"),
	Type.Literal("double"),
	Type.Literal("string"),
], { description: "Script param type hint (default: object). Use double for numbers, string for text." });

export const ScriptIOFields = Type.Object({
	name: Type.String({ description: "Parameter name" }),
	previousName: Type.Optional(
		Type.String({
			description:
				"Old port name when renaming (preserves wires). Use when order changes or swapping names.",
		})
	),
	typeHint: Type.Optional(TypeHintType),
	access: Type.Optional(AccessType),
	dataMapping: Type.Optional(DataMappingType),
	simplify: Type.Optional(Type.Boolean({ description: "Simplify data paths" })),
	reverse: Type.Optional(Type.Boolean({ description: "Reverse item order" })),
});

export const SliderCreateFields = Type.Object({
	min: Type.Number(),
	max: Type.Number(),
	value: Type.Number(),
	digits: Type.Number(),
	interval: Type.Optional(Type.Number({ description: "Not yet processed by backend" })),
});

export const SliderSetFields = Type.Object({
	value: Type.Number(),
});

export const SliderRangeFields = Type.Object({
	min: Type.Number(),
	max: Type.Number(),
	digits: Type.Number(),
	interval: Type.Optional(Type.Number({ description: "Not yet processed by backend" })),
});

export const PanelCreateFields = Type.Object({
	text: Type.String(),
	width: Type.Optional(Type.Number()),
	height: Type.Optional(Type.Number()),
	multiline: Type.Optional(Type.Boolean()),
	bgColor: Type.Optional(Type.String({ description: "rgba string, e.g. 'rgba(255,0,0,255)'" })),
});

export const PanelPropertyFields = Type.Object({
	width: Type.Optional(Type.Number()),
	height: Type.Optional(Type.Number()),
	multiline: Type.Optional(Type.Boolean()),
	bgColor: Type.Optional(Type.String({ description: "rgba string, e.g. 'rgba(255,0,0,255)'" })),
});

export const PanelTextFields = Type.Object({
	text: Type.String(),
});

export const ToggleFields = Type.Object({
	value: Type.Boolean(),
});

export const SwatchFields = Type.Object({
	color: Type.String({ description: "rgba string, e.g. 'rgba(255,0,0,255)'" }),
});

export const ScribbleCreateFields = Type.Object({
	text: Type.String(),
	size: Type.Optional(Type.Number()),
});

export const ScribbleTextFields = Type.Object({
	text: Type.String(),
});

export const ValueListItemFields = Type.Object({
	name: Type.String(),
	value: Type.String(),
});

export const ValueListCreateFields = Type.Object({
	items: Type.Array(ValueListItemFields),
	selectedIndex: Type.Optional(Type.Number()),
});

export const ValueListSelectFields = Type.Object({
	selectedIndex: Type.Number(),
});
