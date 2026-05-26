export const EXCLUDED_TYPE_GUIDS: string[] = [
	"e07753b1-fdec-417a-b57a-83a95204a8dd", // GHZMQ Plugin
];

export const VANILLA_CATEGORIES: ReadonlySet<string> = new Set([
	"Params",
	"Math",
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
	{ category: "Math", subcategory: "Script" },
	{ category: "params", subcategory: "input" },
	{ category: "params", subcategory: "Util" },
];
