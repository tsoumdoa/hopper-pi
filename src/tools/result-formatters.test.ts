import { describe, expect, it } from "vitest";
import { RpcOutcomeUnknownError } from "../infra/runtime-rpc.js";
import { formatToolError, formatToolFailed } from "./result-formatters.js";

describe("tool error presentation", () => {
	it("marks an ambiguous mutation separately from a clean failure", () => {
		const error = new RpcOutcomeUnknownError({
			source: "node",
			lifecycleInstanceId: "life-1",
			requestId: "request-1",
			operation: "setSliderValue",
			operationId: "operation-1",
			result: { class: "outcome_unknown", message: "reply lost after submission" },
		});

		expect(formatToolError("setSliderValue", error)).toContain("outcome UNKNOWN");
		expect(formatToolError("setSliderValue", error)).toContain("It may have completed");
		expect(formatToolError("setSliderValue", error)).toContain("Do not retry automatically");
		expect(formatToolFailed(error)).toMatch(/^OUTCOME UNKNOWN:/);
		expect(formatToolFailed(error)).not.toMatch(/^FAILED:/);
	});
});
