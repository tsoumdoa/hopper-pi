import assert from "node:assert/strict";
import { test } from "vitest";
import {
	createRhinoCaptureModelController,
	promptOverridesVisualCaptureRestriction,
	promptWantsVisualCapture,
	shouldAskVisualCapturePermission,
} from "./rhino-capture-model.js";
import { RH_CAPTURE_VIEW_TOOL } from "./model-capabilities.js";

test("promptWantsVisualCapture detects visual Rhino requests", () => {
	assert.equal(promptWantsVisualCapture("take a screenshot of the Rhino view"), true);
	assert.equal(promptWantsVisualCapture("use visual context to inspect the model"), true);
	assert.equal(promptWantsVisualCapture("look at the view and fix the composition"), true);
	assert.equal(promptWantsVisualCapture("list Rhino layers"), false);
});

test("promptOverridesVisualCaptureRestriction detects explicit opt-in phrasing", () => {
	assert.equal(promptOverridesVisualCaptureRestriction("allow Rhino screenshots now"), true);
	assert.equal(promptOverridesVisualCaptureRestriction("enable visual context for this session"), true);
	assert.equal(promptOverridesVisualCaptureRestriction("screenshots are ok"), true);
	assert.equal(promptOverridesVisualCaptureRestriction("take a screenshot if useful"), false);
});

test("shouldAskVisualCapturePermission requires an active requested capture path", () => {
	assert.equal(shouldAskVisualCapturePermission({
		captureToolActive: false,
		hasDecision: false,
		hasUI: true,
	}), false);
	assert.equal(shouldAskVisualCapturePermission({
		captureToolActive: true,
		hasDecision: true,
		hasUI: true,
	}), false);
	assert.equal(shouldAskVisualCapturePermission({
		captureToolActive: true,
		hasDecision: false,
		hasUI: false,
	}), false);
	assert.equal(shouldAskVisualCapturePermission({
		captureToolActive: true,
		hasDecision: false,
		hasUI: true,
		requestingCapture: false,
	}), false);
	assert.equal(shouldAskVisualCapturePermission({
		captureToolActive: true,
		hasDecision: false,
		hasUI: true,
		requestingCapture: true,
	}), true);
	assert.equal(shouldAskVisualCapturePermission({
		captureToolActive: true,
		hasDecision: true,
		hasUI: true,
		requestingCapture: true,
		allowReconsider: true,
	}), true);
	assert.equal(shouldAskVisualCapturePermission({
		captureToolActive: true,
		hasDecision: false,
		hasUI: true,
		requestingCapture: true,
		overrideConfigured: true,
	}), false);
});

function fakePi() {
	const tools: Array<{ name: string }> = [];
	let activeTools: string[] = ["rh_run_script", "rh_view_control"];
	return {
		registerTool(tool: { name: string }) {
			tools.push(tool);
		},
		getAllTools() {
			return tools;
		},
		getActiveTools() {
			return activeTools;
		},
		setActiveTools(names: string[]) {
			activeTools = names;
		},
		_tools: tools,
		_activeTools: () => activeTools,
	};
}

test("capture tool is only registered for multimodal models", () => {
	const pi = fakePi();
	const controller = createRhinoCaptureModelController(pi as any);

	controller.syncCaptureToolForModel({ provider: "test", id: "text", input: ["text"] });
	assert.equal(pi._tools.some((tool) => tool.name === RH_CAPTURE_VIEW_TOOL), false);

	controller.syncCaptureToolForModel({ provider: "test", id: "vision", input: ["text", "image"] });
	assert.equal(pi._tools.some((tool) => tool.name === RH_CAPTURE_VIEW_TOOL), true);
	assert.equal(pi._activeTools().includes(RH_CAPTURE_VIEW_TOOL), true);
});

test("capture tool is hidden and restored across model changes", () => {
	const pi = fakePi();
	const controller = createRhinoCaptureModelController(pi as any);

	controller.syncCaptureToolForModel({ provider: "test", id: "vision", input: ["text", "image"] });
	controller.syncCaptureToolForModel({ provider: "test", id: "text", input: ["text"] });
	assert.equal(pi._activeTools().includes(RH_CAPTURE_VIEW_TOOL), false);

	controller.syncCaptureToolForModel({ provider: "test", id: "vision", input: ["text", "image"] });
	assert.equal(pi._activeTools().includes(RH_CAPTURE_VIEW_TOOL), true);
});
