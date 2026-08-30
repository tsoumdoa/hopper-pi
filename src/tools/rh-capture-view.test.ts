import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	request: vi.fn(),
}));

vi.mock("../infra/request-helpers.js", () => ({
	withRequester: async (fn: (requester: { request: typeof mocks.request }) => Promise<unknown>) =>
		fn({ request: mocks.request }),
}));

import { rhCaptureViewTool } from "./rh-capture-view.js";

const multimodalCtx = {
	model: { provider: "test", id: "vision", input: ["text", "image"] },
} as any;

const textOnlyCtx = {
	model: { provider: "test", id: "text", input: ["text"] },
} as any;

beforeEach(() => {
	mocks.request.mockReset();
});

test("rh_capture_view captures without a permission decision", async () => {
	mocks.request.mockResolvedValue({
		type: "captureRhinoView.response",
		timestamp: 1,
		ok: true,
		imageBase64: "iVBORw0KGgo=",
		mediaType: "image/png",
		error: "",
		metadata: null,
	});

	const result = await rhCaptureViewTool.execute(
		"tool-call",
		{ view: "active" },
		undefined,
		undefined,
		multimodalCtx,
	);

	assert.equal(mocks.request.mock.calls.length, 1);
	assert.equal(result.content[1]?.type, "image");
});

test("rh_capture_view refuses capture when model does not support images", async () => {
	const result = await rhCaptureViewTool.execute(
		"tool-call",
		{ view: "active" },
		undefined,
		undefined,
		textOnlyCtx,
	);

	assert.equal(mocks.request.mock.calls.length, 0);
	assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /does not support image input/);
	assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /choose a multimodal model in Pi/);
	assert.deepEqual(result.details, { reason: "model_not_multimodal" });
});

test("rh_capture_view returns image content for multimodal models", async () => {
	mocks.request.mockResolvedValue({
		type: "captureRhinoView.response",
		timestamp: 1,
		ok: true,
		imageBase64: "iVBORw0KGgo=",
		mediaType: "image/png",
		error: "",
		metadata: {
			viewName: "Perspective",
			viewportId: "viewport-id",
			projection: "perspective",
			cameraLocation: { x: 1, y: 2, z: 3 },
			cameraTarget: { x: 0, y: 0, z: 0 },
			cameraDirection: { x: -1, y: -2, z: -3 },
			cameraUp: { x: 0, y: 0, z: 1 },
			lensLength: 50,
			cplaneName: "World Top",
			cplaneOrigin: { x: 0, y: 0, z: 0 },
			width: 1280,
			height: 720,
		},
	});

	const result = await rhCaptureViewTool.execute(
		"tool-call",
		{ view: "perspective", width: 99999, height: 720 },
		undefined,
		undefined,
		multimodalCtx,
	);

	assert.equal(mocks.request.mock.calls.length, 1);
	assert.equal(mocks.request.mock.calls[0]?.[0].width, 2000);
	assert.equal(result.content[0]?.type, "text");
	assert.equal(result.content[1]?.type, "image");
	if (result.content[1]?.type === "image") {
		assert.equal(result.content[1].mimeType, "image/png");
		assert.equal(result.content[1].data, "iVBORw0KGgo=");
	}
	assert.equal(
		(result.details as { metadata?: { viewName?: string } }).metadata?.viewName,
		"Perspective",
	);
});
