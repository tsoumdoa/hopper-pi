import assert from "node:assert/strict";
import { test } from "vitest";
import { validateApplyGraphInput } from "../services/gh-apply-graph.js";
import { buildQuickScaffoldGraph } from "./gh-quick-scaffold.js";

test("quick scaffold builds a valid visible placeholder graph", () => {
	const graph = buildQuickScaffoldGraph({
		intent: "test pavilion",
		outputKind: "curves",
		parameters: [
			{ name: "Span Width", min: 1, max: 20, value: 10 },
			{ name: "Bay Count", min: 3, max: 30, value: 8, digits: 0 },
		],
	});

	assert.equal(validateApplyGraphInput(graph).length, 0);
	assert.equal(graph.scripts?.[0]?.ref, "scaffoldScript");
	assert.equal(graph.components?.some((component) => component.ref === "scaffoldPreview" && component.type === "Custom Preview"), true);
	assert.equal(graph.widgets?.some((widget) => widget.ref === "statusPanel"), true);
	assert.equal(graph.widgets?.some((widget) => widget.ref === "previewColor" && widget.kind === "swatch"), true);
	assert.equal(graph.wires?.some((wire) => wire.from[0] === "scaffoldScript" && wire.from[1] === "Status"), true);
	assert.equal(graph.wires?.some((wire) => wire.from[0] === "scaffoldScript" && wire.from[1] === "G" && wire.to[0] === "scaffoldPreview"), true);
	assert.equal(graph.wires?.some((wire) => wire.from[0] === "previewColor" && wire.to[0] === "scaffoldPreview"), true);
	assert.match(graph.scripts?.[0]?.scriptParts?.runScript ?? "", /List<Curve>/);
});

test("quick scaffold sanitizes duplicate parameter names", () => {
	const graph = buildQuickScaffoldGraph({
		parameters: [
			{ name: "1 width", value: 4 },
			{ name: "1 width", value: 5 },
		],
	});
	const inputNames = graph.scripts?.[0]?.inputs?.map((input) => input.name);
	assert.deepEqual(inputNames, ["input_1_width", "input_1_width_2"]);
	assert.equal(validateApplyGraphInput(graph).length, 0);
});

test("quick scaffold keeps generated identifiers separate from C# names", () => {
	const graph = buildQuickScaffoldGraph({
		parameters: [
			{ name: "class" },
			{ name: "G" },
			{ name: "w" },
		],
	});
	const script = graph.scripts?.[0];

	assert.deepEqual(script?.inputs?.map((input) => input.name), ["input_class", "input_G", "input_w"]);
	assert.match(script?.scriptParts?.runScript ?? "", /double input_class, double input_G, double input_w, ref object G/);
	assert.equal(validateApplyGraphInput(graph).length, 0);
});

test("quick scaffold orders reversed slider bounds and clamps the value", () => {
	const graph = buildQuickScaffoldGraph({
		parameters: [{ name: "Scale", min: 10, max: 1, value: 20 }],
	});
	const slider = graph.widgets?.find((widget) => widget.kind === "slider");

	assert.equal(slider?.kind, "slider");
	if (slider?.kind !== "slider") assert.fail("expected slider widget");
	assert.equal(slider.min, 1);
	assert.equal(slider.max, 10);
	assert.equal(slider.value, 10);
	assert.equal(validateApplyGraphInput(graph).length, 0);
});
