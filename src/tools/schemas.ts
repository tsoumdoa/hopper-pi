import { Type } from "@earendil-works/pi-ai";

export const RhinoObjectTypeSchema = Type.Union(
	[
		Type.Literal("curve"),
		Type.Literal("point"),
		Type.Literal("brep"),
		Type.Literal("surface"),
		Type.Literal("mesh"),
	],
	{ description: "Rhino geometry kind" },
);

export const ResultLimitSchema = Type.Integer({
	minimum: 1,
	maximum: 100,
	description: "Maximum results to return (1–100)",
});

export const ResultOffsetSchema = Type.Integer({
	minimum: 0,
	description: "Zero-based pagination offset",
});
