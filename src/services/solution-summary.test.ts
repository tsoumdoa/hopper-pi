import { describe, expect, it } from "vitest";
import { formatSolutionSummary } from "./solution-summary.js";
import type { CanvasError, GetCanvasErrorsResponse } from "../types/messages.js";

function response(errors: CanvasError[]): GetCanvasErrorsResponse {
	return {
		type: "getCanvasErrors.response",
		timestamp: 0,
		docName: "Test",
		errors,
	};
}

const err = (text: string, level: CanvasError["level"] = "error"): CanvasError => ({
	componentId: "abc",
	componentNickName: "Comp",
	level,
	text,
});

describe("formatSolutionSummary", () => {
	it("reports a clean solution", () => {
		expect(formatSolutionSummary(response([]))).toBe("solution: no errors or warnings");
	});

	it("treats message-level entries as clean", () => {
		expect(formatSolutionSummary(response([err("hello", "message")]))).toBe(
			"solution: no errors or warnings",
		);
	});

	it("summarizes errors before warnings with counts", () => {
		const text = formatSolutionSummary(
			response([err("warned", "warning"), err("broke")]),
		);
		const lines = text.split("\n");
		expect(lines[0]).toBe("solution: 1 error(s), 1 warning(s)");
		expect(lines[1]).toContain("❌ [Comp] broke");
		expect(lines[2]).toContain("⚠️ [Comp] warned");
	});

	it("truncates long messages and flattens newlines", () => {
		const text = formatSolutionSummary(response([err(`line1\nline2 ${"x".repeat(200)}`)]));
		expect(text).toContain("line1 line2");
		expect(text).toContain("…");
		expect(text.split("\n")[1].length).toBeLessThan(140);
	});

	it("caps shown entries and points to gh_get_canvas_errors", () => {
		const many = Array.from({ length: 5 }, (_, i) => err(`error ${i}`));
		const text = formatSolutionSummary(response(many));
		expect(text).toContain("solution: 5 error(s), 0 warning(s)");
		expect(text).toContain("… 2 more — call gh_get_canvas_errors");
	});
});
