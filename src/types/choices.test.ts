import assert from "node:assert/strict";
import { test } from "vitest";
import {
	OTHER_OPTION_LABEL,
	appendOtherOptionLabels,
	formatPickOptionLabels,
	resolvePickOption,
	type PickOption,
} from "./choices.js";

const options: PickOption[] = [
	{ label: "Pipe", value: "guid-pipe", description: "Surface > Freeform" },
	{ label: "Divide Surface", value: "guid-divide" },
];

test("formats labels with descriptions and resolves the selected display label", () => {
	const labels = formatPickOptionLabels(options);
	assert.deepEqual(labels, [
		"Pipe — Surface > Freeform",
		"Divide Surface",
	]);
	assert.equal(resolvePickOption(options, labels[0])?.value, "guid-pipe");
});

test("appends Other once", () => {
	assert.deepEqual(appendOtherOptionLabels(["A", "B"]), ["A", "B", OTHER_OPTION_LABEL]);
});

test("skips Other when already present", () => {
	assert.deepEqual(appendOtherOptionLabels(["A", "Other"]), ["A", "Other"]);
	assert.deepEqual(appendOtherOptionLabels(["A", " other "]), ["A", " other "]);
});

test("does not treat other-prefixed labels as the canonical Other choice", () => {
	assert.deepEqual(appendOtherOptionLabels(["A", "Others"]), ["A", "Others", OTHER_OPTION_LABEL]);
});
