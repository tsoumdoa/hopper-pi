import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import {
	getRhinoVisualCaptureConsent,
	resetRhinoVisualCaptureConsent,
	resetRhinoVisualCaptureState,
	setRhinoVisualCaptureConsent,
	VISUAL_CAPTURE_ENV_VAR,
} from "../services/rhino-visual-consent.js";

const mocks = vi.hoisted(() => ({
	request: vi.fn(),
}));

vi.mock("../infra/request-helpers.js", () => ({
	withRequester: async (fn: (requester: { request: typeof mocks.request }) => Promise<unknown>) =>
		fn({ request: mocks.request }),
}));

import { rhCaptureViewTool } from "./rh-capture-view.js";

function captureContext(options: { supportsImages: boolean; captureAllowed: boolean }) {
	return {
		toolCallId: "tool-call",
		supportsImages: options.supportsImages,
		captureAllowed: options.captureAllowed,
	};
}

beforeEach(() => {
	delete process.env[VISUAL_CAPTURE_ENV_VAR];
	resetRhinoVisualCaptureState();
	mocks.request.mockReset();
});

test("Rhino visual capture consent defaults to unknown and supports session reset", () => {
	assert.equal(getRhinoVisualCaptureConsent(), "unknown");
	setRhinoVisualCaptureConsent(true);
	assert.equal(getRhinoVisualCaptureConsent(), "allowed");
	resetRhinoVisualCaptureConsent();
	assert.equal(getRhinoVisualCaptureConsent(), "unknown");
	setRhinoVisualCaptureConsent(false);
	assert.equal(getRhinoVisualCaptureConsent(), "denied");
});

test("Rhino visual capture consent can be overridden by env", () => {
	setRhinoVisualCaptureConsent(false);
	process.env[VISUAL_CAPTURE_ENV_VAR] = "allow";
	assert.equal(getRhinoVisualCaptureConsent(), "allowed");

	process.env[VISUAL_CAPTURE_ENV_VAR] = "deny";
	assert.equal(getRhinoVisualCaptureConsent(), "denied");
});

test("rh_capture_view refuses capture when consent is not allowed", async () => {
	const result = await rhCaptureViewTool.execute(
		{ view: "active" },
		captureContext({ supportsImages: true, captureAllowed: false }),
	);

	assert.equal(mocks.request.mock.calls.length, 0);
	const text = result.content[0]?.type === "text" ? result.content[0].text : "";
	assert.match(text, /requires explicit approval/);
	assert.equal(result.isError, true);
	assert.equal((result.details as any).error.code, "consent_required");
});

test("rh_capture_view allows capture when its adapter grants consent", async () => {
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
		{ view: "active" },
		captureContext({ supportsImages: true, captureAllowed: true }),
	);

	assert.equal(mocks.request.mock.calls.length, 1);
	assert.equal(result.content[1]?.type, "image");
});

test("rh_capture_view refuses capture when model does not support images", async () => {
	const result = await rhCaptureViewTool.execute(
		{ view: "active" },
		captureContext({ supportsImages: false, captureAllowed: true }),
	);

	assert.equal(mocks.request.mock.calls.length, 0);
	assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /cannot receive/);
	assert.equal(result.isError, true);
	assert.equal((result.details as any).error.code, "unsupported_client");
});

test("rh_capture_view returns image content when consent is allowed", async () => {
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
		{ view: "perspective", width: 99999, height: 720 },
		captureContext({ supportsImages: true, captureAllowed: true }),
	);

	assert.equal(mocks.request.mock.calls.length, 1);
	assert.equal(mocks.request.mock.calls[0]?.[0].width, 2000);
	assert.equal(result.content[0]?.type, "text");
	assert.equal(result.content[1]?.type, "image");
	if (result.content[1]?.type === "image") {
		assert.equal(result.content[1].mimeType, "image/png");
		assert.equal(result.content[1].data, "iVBORw0KGgo=");
	}
	assert.equal((result.details as { allowed?: boolean }).allowed, true);
});
