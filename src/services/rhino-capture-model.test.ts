import assert from "node:assert/strict";
import { test } from "vitest";
import {
	createRhinoCaptureModelController,
	promptWantsVisualCapture,
	rhinoCaptureUnavailableGuidance,
} from "./rhino-capture-model.js";
import { RH_CAPTURE_VIEW_TOOL } from "./model-capabilities.js";

test("promptWantsVisualCapture detects visual Rhino requests", () => {
	assert.equal(promptWantsVisualCapture("take a screenshot of the Rhino view"), true);
	assert.equal(promptWantsVisualCapture("use visual context to inspect the model"), true);
	assert.equal(promptWantsVisualCapture("look at the view and fix the composition"), true);
	assert.equal(promptWantsVisualCapture("list Rhino layers"), false);
});

test("rhinoCaptureUnavailableGuidance points user to multimodal model", () => {
	const guidance = rhinoCaptureUnavailableGuidance({ provider: "test", id: "text", input: ["text"] });
	assert.match(guidance, /does not support image input/);
	assert.match(guidance, /choose a multimodal model in Pi/);
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
	assert.equal(pi._activeTools().includes(RH_CAPTURE_VIEW_TOOL), true);
});

test("capture tool is restored after an external deactivation (progressive reset)", () => {
	const pi = fakePi();
	const controller = createRhinoCaptureModelController(pi as never);
	const vision = { provider: "test", id: "vision", input: ["text", "image"] };

	controller.syncCaptureToolForModel(vision);
	assert.equal(pi._activeTools().includes(RH_CAPTURE_VIEW_TOOL), true);

	pi.setActiveTools(pi._activeTools().filter((name) => name !== RH_CAPTURE_VIEW_TOOL));
	controller.syncCaptureToolForModel(vision);
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
