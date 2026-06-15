import { describe, expect, it } from "vitest";
import {
	OTHER_OPTION_LABEL,
	appendOtherOptionLabels,
	formatPickOptionLabels,
	isOtherChoice,
	resolvePickOption,
	type PickOption,
} from "./choices.js";

describe("choices types", () => {
	const options: PickOption[] = [
		{ label: "Pipe", value: "guid-pipe", description: "Surface > Freeform" },
		{ label: "Divide Surface", value: "guid-divide" },
	];

	it("formats labels with descriptions", () => {
		expect(formatPickOptionLabels(options)).toEqual([
			"Pipe — Surface > Freeform",
			"Divide Surface",
		]);
	});

	it("resolves selection by display label", () => {
		const labels = formatPickOptionLabels(options);
		expect(resolvePickOption(options, labels[0])?.value).toBe("guid-pipe");
	});

	it("appends Other once", () => {
		expect(appendOtherOptionLabels(["A", "B"])).toEqual(["A", "B", OTHER_OPTION_LABEL]);
	});

	it("skips Other when already present", () => {
		expect(appendOtherOptionLabels(["A", "Other"])).toEqual(["A", "Other"]);
		expect(appendOtherOptionLabels(["A", "Others"])).toEqual(["A", "Others"]);
	});

	it("detects Other choice", () => {
		expect(isOtherChoice(OTHER_OPTION_LABEL)).toBe(true);
		expect(isOtherChoice("Pipe")).toBe(false);
	});
});
