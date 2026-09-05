import assert from "node:assert/strict";
import { test } from "vitest";
import type { GhComponentInfo } from "../types/messages.js";
import {
	tokenizeQuery,
	searchMatchedComponents,
	formatComponentLines,
} from "../services/component-search.js";

function comp(
	name: string,
	overrides: Partial<GhComponentInfo> = {},
): GhComponentInfo {
	return {
		name,
		typeGuid: `00000000-0000-0000-0000-${name.replace(/\s/g, "").slice(0, 12).padEnd(12, "0")}`,
		pluginName: "Test",
		assemblyName: "Test",
		category: overrides.category ?? "Surface",
		subcategory: overrides.subcategory ?? "Util",
		description: overrides.description ?? "",
		...overrides,
	};
}

const FIXTURE: GhComponentInfo[] = [
	comp("Divide Surface", { description: "Generate a grid of points on a surface." }),
	comp("Isotrim", { description: "Extract an isoparametric subset of a surface." }),
	comp("Trim with Brep", {
		category: "Intersect",
		subcategory: "Region",
		description: "Trim a curve with a Brep.",
	}),
	comp("Trim with Breps", {
		category: "Intersect",
		subcategory: "Region",
		description: "Trim a curve with multiple Breps.",
	}),
	comp("Trim Solid", {
		category: "Intersect",
		subcategory: "Shape",
		description: "Cut holes into a shape.",
	}),
];

function topName(query: string): string {
	return searchMatchedComponents(FIXTURE, query)[0]?.name ?? "";
}

function matchedNames(query: string): string[] {
	return searchMatchedComponents(FIXTURE, query).map((c) => c.name);
}

test("query-handlers search", () => {
	// --- tokenizeQuery ---

	assert.deepEqual(tokenizeQuery("divSrf isotrim"), ["div", "srf", "isotrim"]);
	assert.deepEqual(tokenizeQuery("trim brep"), ["trim", "brep"]);
	assert.deepEqual(tokenizeQuery("a"), []);

	// --- search ranking ---

	assert.ok(matchedNames("Trim").some((n) => n.startsWith("Trim")), "Trim query matches trim components");
	assert.equal(topName("trim brep"), "Trim with Brep", "multi-token prefers Trim with Brep");
	assert.equal(topName("isotrim"), "Isotrim");
	assert.ok(
		matchedNames("divSrf").slice(0, 5).includes("Divide Surface"),
		"divSrf shorthand surfaces Divide Surface in top 5",
	);

	const both = matchedNames("divSrf isotrim");
	assert.ok(both.includes("Divide Surface"), "OR: Divide Surface in matches");
	assert.ok(both.includes("Isotrim"), "OR: Isotrim in matches");
});

test("formatComponentLines", () => {
	const analysis = [
		comp("Evaluate Surface", { subcategory: "Analysis", description: "Evaluate local surface properties." }),
		comp("Evaluate Box", { subcategory: "Analysis", description: "Evaluate a box in normalised space." }),
	];
	const output = formatComponentLines(analysis);
	const lines = output.split("\n");

	assert.equal(lines.length, 2);
	assert.ok(!output.includes("=="), "no category header markers");
	assert.match(lines[0], /^Evaluate Surface \[.+\] · Surface\/Analysis — Evaluate local surface properties\.$/);
	assert.match(lines[1], /^Evaluate Box \[.+\] · Surface\/Analysis — Evaluate a box in normalised space\.$/);

	const order = formatComponentLines([
		comp("Zed", { category: "Zoo", subcategory: "Alpha", description: "last" }),
		comp("Ape", { category: "Aardvark", subcategory: "Beta", description: "first" }),
	]);
	assert.equal(order.split("\n")[0]?.startsWith("Zed "), true, "preserves input order");
	assert.equal(order.split("\n")[1]?.startsWith("Ape "), true, "preserves input order");

	const noDesc = formatComponentLines([comp("Panel", { description: "" })]);
	assert.match(noDesc, /^Panel \[.+\] · Surface\/Util$/);

	const longDesc = "x".repeat(95);
	assert.match(
		formatComponentLines([comp("Long", { description: longDesc })]),
		/^Long \[.+\] · Surface\/Util — x{87}\.\.\.$/,
	);
});
