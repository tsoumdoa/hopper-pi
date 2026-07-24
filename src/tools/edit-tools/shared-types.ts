import { Type } from "@earendil-works/pi-ai";

export const DataMappingType = Type.Union([
	Type.Literal("none"),
	Type.Literal("flatten"),
	Type.Literal("graft"),
]);


export const AccessType = Type.Union([
	Type.Literal("item"),
	Type.Literal("list"),
	Type.Literal("tree"),
]);

export const TypeHintType = Type.Union([
	Type.Literal("object"),
	Type.Literal("double"),
	Type.Literal("int"),
	Type.Literal("string"),
	Type.Literal("bool"),
]);

export const ScriptIOFields = Type.Object({
	name: Type.String(),
	previousName: Type.Optional(Type.String()),
	typeHint: Type.Optional(TypeHintType),
	access: Type.Optional(AccessType),
	dataMapping: Type.Optional(DataMappingType),
	simplify: Type.Optional(Type.Boolean()),
	reverse: Type.Optional(Type.Boolean()),
});

export const SliderCreateFields = Type.Object({
	min: Type.Number(),
	max: Type.Number(),
	value: Type.Number(),
	digits: Type.Integer({ minimum: 0, maximum: 12 }),
});

export const SliderSetFields = Type.Object({
	value: Type.Number(),
});

export const SliderRangeFields = Type.Object({
	min: Type.Number(),
	max: Type.Number(),
	digits: Type.Integer({ minimum: 0, maximum: 12 }),
});

export const PanelTextOutputType = Type.Union([
	Type.Literal("singleString"),
	Type.Literal("oneItemPerLine"),
], {
	description: "Default singleString.",
});

export const PanelCreateFields = Type.Object({
	text: Type.String(),
	textOutput: PanelTextOutputType,
	width: Type.Optional(Type.Number()),
	height: Type.Optional(Type.Number()),
	bgColor: Type.Optional(Type.String()),
});

export const PanelPropertyFields = Type.Object({
	textOutput: PanelTextOutputType,
	width: Type.Optional(Type.Number()),
	height: Type.Optional(Type.Number()),
	bgColor: Type.Optional(Type.String()),
});

export const PanelTextFields = Type.Object({
	text: Type.String(),
});

export const ToggleFields = Type.Object({
	value: Type.Boolean(),
});

export const SwatchFields = Type.Object({
	color: Type.String(),
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
	items: Type.Array(ValueListItemFields, { minItems: 1 }),
	selectedIndex: Type.Optional(Type.Number()),
});

export const ValueListSelectFields = Type.Object({
	selectedIndex: Type.Integer({ minimum: 0 }),
});
