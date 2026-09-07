import { expect, it, vi } from "vitest";
import { RpcOperationError } from "../infra/runtime-rpc.js";
import { runRhinoScript } from "./rhino-script-handlers.js";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../infra/request-helpers.js", () => ({
	withRequester: (fn: Function) => fn({ request }),
}));

it("preserves native stack traces and partial output in session tool text", async () => {
	const error = "Stages: code-run@12ms\nSystem.NullReferenceException: failed\n   at Script.Run()";
	request.mockRejectedValueOnce(new RpcOperationError("runRhinoScript", {
		class: "failed",
		reasonCode: "OPERATION_FAILED",
		message: error,
		data: { type: "runRhinoScript.response", ok: false, error,
			output: "before failure\nLoading Python 3 (50%)" },
	}));
	const text = await runRhinoScript({ mode: "python", source: "print('before failure')" });
	expect(text).toContain(error);
	expect(text).toContain("before failure\nLoading Python 3 (50%)");
	expect(text).toContain("FAILED (mode=python)");
});

it("does not turn transport errors into native script results", async () => {
	const error = new Error("connection lost");
	request.mockRejectedValueOnce(error);
	await expect(runRhinoScript({ mode: "python", source: "pass" })).rejects.toBe(error);
});
