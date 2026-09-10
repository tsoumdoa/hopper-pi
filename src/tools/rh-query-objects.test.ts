import { beforeEach, expect, it, vi } from "vitest";
import { validateRpcRequest } from "../protocol/v2.js";
import { rhQueryObjectsTool } from "./rh-query-objects.js";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../infra/request-helpers.js", () => ({
	withRequester: (fn: (requester: { request: typeof request }) => Promise<unknown>) =>
		fn({ request }),
}));

const objectId = "e6ab073d-c69f-4602-8be4-fbcad9cfd3fd";

beforeEach(() => {
	request.mockReset();
	request.mockImplementation(async ({ type, ...args }) => {
		// Validate before JSON serialization, just like the real RPC client.
		const validation = validateRpcRequest({
			protocolVersion: 2,
			lifecycleInstanceId: "life-test",
			requestId: "request-test",
			token: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
			operation: type,
			startDeadlineAt: 0,
			args,
		});
		if (!validation.ok) throw new Error(validation.errors.join("; "));
		return {
			type: "queryRhinoObjects.response",
			timestamp: 0,
			objects: [{ objectId, name: "Hello World", layer: "Hello World", objectType: "text" }],
		};
	});
});

it.each([
	{ layer: "Hello World", countOnly: true },
	{ layer: "Hello World", limit: 20 },
])("accepts the layer query %j with omitted optional filters", async (params) => {
	const result = await rhQueryObjectsTool.execute("call-test", params, undefined, undefined, {} as never);
	expect(request).toHaveBeenCalledWith({ type: "queryRhinoObjects", layer: "Hello World" });
	expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("1 Rhino object(s)") });
});

it("accepts an unfiltered query", async () => {
	await rhQueryObjectsTool.execute("call-test", {}, undefined, undefined, {} as never);
	expect(request).toHaveBeenCalledWith({ type: "queryRhinoObjects" });
});

it("preserves explicit filters including false and resolves short object IDs", async () => {
	const { toShortRhinoGuid } = await import("../services/guid-shortener.js");
	await rhQueryObjectsTool.execute("call-test", {
		selectionOnly: false,
		layer: "Hello World",
		objectType: "curve",
		objectIds: [toShortRhinoGuid(objectId)],
	}, undefined, undefined, {} as never);
	expect(request).toHaveBeenCalledWith({
		type: "queryRhinoObjects",
		selectionOnly: false,
		layer: "Hello World",
		objectType: "curve",
		objectIds: [objectId],
	});
});
