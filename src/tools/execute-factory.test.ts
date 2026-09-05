import { expect, it, vi } from "vitest";
import { RpcOutcomeUnknownError } from "../infra/runtime-rpc.js";
import { submitCommand } from "../infra/command-dispatch.js";
import { createExecute } from "./execute-factory.js";

vi.mock("../infra/command-dispatch.js", () => ({ submitCommand: vi.fn() }));

it.each([
	{ error: new Error("document closed"), expected: "setSliderValue error: document closed" },
	{
		error: new RpcOutcomeUnknownError({
			source: "node",
			lifecycleInstanceId: "life-1",
			requestId: "request-1",
			operation: "setSliderValue",
			operationId: "operation-1",
			result: { class: "outcome_unknown", message: "reply lost after submission" },
		}),
		expected: "setSliderValue outcome UNKNOWN:",
	},
])("reports $error.name without formatting a failed edit as completed", async ({ error, expected }) => {
	const submit = vi.mocked(submitCommand).mockReset();
	submit.mockRejectedValueOnce(error).mockResolvedValueOnce({ jobId: "operation-2" });
	const formatSuccess = vi.fn((value: number) => `value ${value} completed`);
	const execute = createExecute(
		(value: number) => ({ action: "setSliderValue", params: { value } }),
		formatSuccess,
	);

	const result = await execute("tool-1", { items: [1, 2] }, undefined, undefined);
	const text = result.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
	expect(text).toContain(expected);
	expect(text).not.toContain("value 1 completed");
	expect(text).toContain("value 2 completed");
	expect(formatSuccess).toHaveBeenCalledExactlyOnceWith(2, { jobId: "operation-2" });
	expect(submit).toHaveBeenCalledTimes(2);
	if (error instanceof RpcOutcomeUnknownError) expect(text).toContain("Do not retry automatically");
});
