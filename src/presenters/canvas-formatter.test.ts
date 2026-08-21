import assert from "node:assert/strict";
import { test } from "vitest";
import type { Component } from "../types/gh.js";
import { formatCanvasData } from "./canvas-formatter.js";

function component(id: string, type: string): Component {
	return {
		id,
		type,
		typeGuid: `${id.padEnd(8, "0")}-0000-0000-0000-000000000000`,
		instanceGuid: `${id.padEnd(8, "1")}-1111-1111-1111-111111111111`,
		nickName: id,
		inputs: {},
		outputs: {},
	};
}

test("unfiltered Pi canvas output stays at the subgraph index", () => {
	const fullGuid = "a1111111-1111-1111-1111-111111111111";
	const formatted = formatCanvasData({
		docName: "trial.gh",
		componentCount: 3,
		wireCount: 1,
		subGraphCount: 2,
		components: {
			a: { ...component("a", "Addition"), instanceGuid: fullGuid },
			b: component("b", "Panel"),
			c: component("c", "Slider"),
		},
		wires: [{ from: "a.out", to: "b.in" }],
		subGraphs: [
			{ id: "subgraph_0", components: ["a", "b"], internalWires: [{ from: "a.out", to: "b.in" }], externalWires: [] },
			{ id: "subgraph_1", components: ["c"], internalWires: [], externalWires: [] },
		],
	});

	const text = formatted.content[0].text;
	assert.match(text, /Sub-graph index:/);
	assert.match(text, /subgraph_0/);
	assert.doesNotMatch(text, new RegExp(fullGuid));
	assert.equal("components" in formatted.details, false);
});
