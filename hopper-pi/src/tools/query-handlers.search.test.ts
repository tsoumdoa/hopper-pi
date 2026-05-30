import assert from "node:assert/strict";
import type { GhComponentInfo } from "../types/messages.js";
import {
	tokenizeQuery,
	scoreComponent,
	scoreComponentQuery,
	searchMatchedComponents,
} from "./query-handlers.js";

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

// --- tokenizeQuery ---

assert.deepEqual(tokenizeQuery("divSrf isotrim"), ["div", "srf", "isotrim"]);
assert.deepEqual(tokenizeQuery("trim brep"), ["trim", "brep"]);
assert.deepEqual(tokenizeQuery("a"), []);

// --- scoreComponent ---

assert.ok(scoreComponent(comp("Isotrim"), "isotrim") >= 100);
assert.ok(scoreComponent(comp("Divide Surface"), "div") >= 75);
assert.ok(scoreComponent(comp("Divide Surface"), "srf") >= 62);

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

const trimBrepScore = scoreComponentQuery(comp("Trim with Brep"), tokenizeQuery("trim brep"));
const trimSolidScore = scoreComponentQuery(comp("Trim Solid"), tokenizeQuery("trim brep"));
assert.ok(trimBrepScore.score > trimSolidScore.score, "all-token bonus ranks Trim with Brep above partial matches");

console.log("query-handlers.search.test.ts: all assertions passed");
