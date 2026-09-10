import { describe, expect, it, vi } from "vitest";
import { mockRuntimeStatus } from "../mocks/hopper-mock";
import { requestRuntimeStatus } from "../hooks/use-runtime-status";

describe("runtime status UI", () => {
	it("requests the authenticated runtime snapshot", async () => {
		const request = vi.fn(async () => new Response(JSON.stringify(mockRuntimeStatus), { status: 200 }));
		await expect(requestRuntimeStatus("runtime-token", request)).resolves.toEqual(mockRuntimeStatus);
		expect(request).toHaveBeenCalledWith("/api/runtime-status", {
			headers: { Authorization: "Bearer runtime-token" },
			cache: "no-store",
		});
	});
});
