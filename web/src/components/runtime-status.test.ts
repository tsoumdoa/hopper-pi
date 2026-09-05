import { describe, expect, it, vi } from "vitest";
import { mockRuntimeStatus } from "../mocks/hopper-mock";
import { requestRuntimeStatus } from "../hooks/use-runtime-status";
import { runtimeStatusRows, summarizeRuntimeStatus } from "./runtime-status";

describe("runtime status UI", () => {
	it("requests the authenticated runtime snapshot", async () => {
		const request = vi.fn(async () => new Response(JSON.stringify(mockRuntimeStatus), { status: 200 }));
		await expect(requestRuntimeStatus("runtime-token", request)).resolves.toEqual(mockRuntimeStatus);
		expect(request).toHaveBeenCalledWith("/api/runtime-status", {
			headers: { Authorization: "Bearer runtime-token" },
			cache: "no-store",
		});
	});

	it("rejects a failed runtime request", async () => {
		const request = vi.fn(async () => new Response(null, { status: 503 }));
		await expect(requestRuntimeStatus("runtime-token", request)).rejects.toThrow("HTTP 503");
	});

	it("summarizes the typed runtime status", () => {
		expect(summarizeRuntimeStatus(mockRuntimeStatus, null)).toEqual({
			tone: "ok",
			text: "Running · atrium-study.3dm",
		});
		expect(Object.fromEntries(runtimeStatusRows(mockRuntimeStatus))).toMatchObject({
			Host: "Running · PID 5124 · Node 22.19.0 · Live handshake · 0 health failures",
			Dispatcher: "0/64 queued · accepting work",
		});
	});
});
