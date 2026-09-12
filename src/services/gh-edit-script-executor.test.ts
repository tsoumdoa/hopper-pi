import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeGhEditScript } from "./gh-edit-script-executor.js";
import { presentGhEditScriptExecution } from "../tools/edit-tools/gh-edit-script-render.js";
import { fetchScriptCode } from "../infra/canvas-fetch.js";
import { submitCommand } from "../infra/command-dispatch.js";
import type { GhEditScriptItem } from "../types/gh-edit-script.js";

vi.mock("../infra/canvas-fetch.js", () => ({ fetchScriptCode: vi.fn() }));
vi.mock("../infra/command-dispatch.js", () => ({ submitCommand: vi.fn() }));
vi.mock("../infra/request-helpers.js", () => ({ withRequester: (run: (req: unknown) => unknown) => run({}) }));
vi.mock("./guid-shortener.js", () => ({ resolveInstanceGuid: (id: string) => id }));

beforeEach(() => vi.resetAllMocks());

describe("script execution and presentation", () => {
	it("keeps queries before mutations and preserves agent text and redacted details", async () => {
		vi.mocked(fetchScriptCode).mockResolvedValue({ code: "print(1)\nprint(2)" } as Awaited<ReturnType<typeof fetchScriptCode>>);
		vi.mocked(submitCommand).mockResolvedValue({ jobId: "job-1" });
		const mutation: GhEditScriptItem = { action: "setCode", targetId: "script-1", code: "print(3)" };
		const query: GhEditScriptItem = { action: "getCode", targetId: "script-1" };
		const progress = vi.fn();
		const execution = await executeGhEditScript([mutation, query], progress);
		expect(execution.outcomes.map((outcome) => outcome.kind)).toEqual(["query", "mutation"]);
		expect(progress.mock.calls.map(([item]) => item.action)).toEqual(["getCode", "setCode"]);
		expect(submitCommand).toHaveBeenCalledWith("setScriptCode", {
			targetId: "script-1", code: "print(3)", inputs: undefined, outputs: undefined,
		});
		const presented = presentGhEditScriptExecution(execution);
		expect(presented.content).toEqual([{ type: "text", text: "print(1)\nprint(2)\nsetCode completed. shortId=script-1 -> resolvedGuid=script-1, jobId=job-1" }]);
		expect(presented.details).toMatchObject({ queryCount: 1, mutationCount: 1, items: [{ code: { chars: 8, lines: 1 } }, { action: "getCode" }] });
		expect(presented.details.results[0]).toBe("getCode target=script-1 → 2 lines");
	});

	it("does not submit mutations when preparation or validation fails", async () => {
		vi.mocked(fetchScriptCode).mockRejectedValue(new Error("read unavailable"));
		const prepared = presentGhEditScriptExecution(await executeGhEditScript([
			{ action: "patchCode", targetId: "script-1", patches: [{ op: "insert", afterLine: 0, lines: ["print(1)"] }] },
		]));
		expect(prepared.details).toMatchObject({ error: "read unavailable", results: ["prepare failed: read unavailable"], mutationCount: 0 });
		const validated = presentGhEditScriptExecution(await executeGhEditScript([
			{ action: "create", language: "python", x: 0, y: 0 },
		]));
		expect(validated.content).toEqual([{ type: "text", text: "Python create requires code." }]);
		expect(submitCommand).not.toHaveBeenCalled();
	});

	it("presents query failures and still propagates mutation failures", async () => {
		const error = new Error("connection lost");
		vi.mocked(fetchScriptCode).mockRejectedValue(error);
		const execution = await executeGhEditScript([{ action: "getCode", targetId: "script-1" }]);
		expect(execution.outcomes[0]).toMatchObject({ kind: "queryError", error });
		expect(presentGhEditScriptExecution(execution).content).toEqual([{ type: "text", text: "getCode error: connection lost" }]);
		vi.mocked(submitCommand).mockRejectedValue(error);
		await expect(executeGhEditScript([{ action: "setCode", targetId: "script-1", code: "print(1)" }])).rejects.toBe(error);
	});
});
