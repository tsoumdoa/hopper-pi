export const EXCLUDED_TYPE_GUIDS: string[] = [
	"e07753b1-fdec-417a-b57a-83a95204a8dd", // GHZMQ Plugin
];

export const VANILLA_CATEGORIES: ReadonlySet<string> = new Set([
	"Params",
	"Maths",
	"Sets",
	"Vector",
	"Curve",
	"Surface",
	"Mesh",
	"Intersect",
	"Transform",
	"Display",
	"Rhino",
]);

export const BLACKLISTED_SUBCATEGORIES: ReadonlyArray<{
	category: string;
	subcategory: string;
}> = [
	{ category: "Maths", subcategory: "Script" },
	{ category: "Params", subcategory: "Input" },
	{ category: "Params", subcategory: "Util" },
];
