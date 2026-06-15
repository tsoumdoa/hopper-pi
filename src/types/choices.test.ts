import assert from "node:assert/strict";
import { test } from "vitest";
import {
	OTHER_OPTION_LABEL,
	appendOtherOptionLabels,
	formatPickOptionLabels,
	isOtherChoice,
	resolvePickOption,
	type PickOption,
} from "./choices.js";

const options: PickOption[] = [
	{ label: "Pipe", value: "guid-pipe", description: "Surface > Freeform" },
	{ label: "Divide Surface", value: "guid-divide" },
];

test("formats labels with descriptions", () => {
	assert.deepEqual(formatPickOptionLabels(options), [
		"Pipe — Surface > Freeform",
		"Divide Surface",
	]);
});

test("resolves selection by display label", () => {
	const labels = formatPickOptionLabels(options);
	assert.equal(resolvePickOption(options, labels[0])?.value, "guid-pipe");
});

test("appends Other once", () => {
	assert.deepEqual(appendOtherOptionLabels(["A", "B"]), ["A", "B", OTHER_OPTION_LABEL]);
});

test("skips Other when already present", () => {
	assert.deepEqual(appendOtherOptionLabels(["A", "Other"]), ["A", "Other"]);
	assert.deepEqual(appendOtherOptionLabels(["A", "Others"]), ["A", "Others"]);
});

test("detects Other choice", () => {
	assert.equal(isOtherChoice(OTHER_OPTION_LABEL), true);
	assert.equal(isOtherChoice("Pipe"), false);
});
