import assert from "node:assert/strict";
import { test, vi } from "vitest";
import {
	createRhinoCaptureModelController,
	promptWantsVisualCapture,
} from "./rhino-capture-model.js";

test("promptWantsVisualCapture detects visual Rhino requests", () => {
	assert.equal(promptWantsVisualCapture("take a screenshot of the Rhino view"), true);
	assert.equal(promptWantsVisualCapture("use visual context to inspect the model"), true);
	assert.equal(promptWantsVisualCapture("look at the view and fix the composition"), true);
	assert.equal(promptWantsVisualCapture("list Rhino layers"), false);
});

test("fallback switches to the selected vision model without managing tools", async () => {
	const vision = { provider: "test", id: "vision", input: ["text", "image"] };
	const pi = { setModel: vi.fn(async () => true) };
	const controller = createRhinoCaptureModelController(pi as never, "test/vision");
	const notify = vi.fn();
	await controller.maybeSwitchToMultimodalFallback({
		model: { input: ["text"] },
		hasUI: true,
		modelRegistry: { find: () => vision },
		ui: { select: async () => "Switch to test/vision", notify },
	} as never);
	assert.deepEqual(pi.setModel.mock.calls, [[vision]]);
	assert.equal(notify.mock.calls.length, 0);
});

test("fallback leaves the model unchanged when the user declines", async () => {
	const pi = { setModel: vi.fn() };
	const controller = createRhinoCaptureModelController(pi as never, "test/vision");
	await controller.maybeSwitchToMultimodalFallback({
		model: { input: ["text"] },
		hasUI: true,
		modelRegistry: { find: () => ({ input: ["text", "image"] }) },
		ui: { select: async () => "Continue without screenshots", notify: vi.fn() },
	} as never);
	assert.equal(pi.setModel.mock.calls.length, 0);
});
