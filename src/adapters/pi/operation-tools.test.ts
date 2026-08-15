import assert from "node:assert/strict";
import { test } from "vitest";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { JsonObject, JsonValue } from "../../core/contracts.js";
import type { OperationContext } from "../../core/operations.js";
import { HOPPER_OPERATIONS, createOperationRegistry } from "../../operations/index.js";
import { createPiOperationTools } from "./operation-tools.js";

const MINIMAL_ARCHIVE = `<?xml version="1.0" encoding="utf-8"?>
<Archive name="Root">
  <items count="1"><item name="ArchiveVersion" type_name="gh_version"><Major>1</Major><Minor>0</Minor><Revision>0</Revision></item></items>
  <chunks count="1"><chunk name="Definition"><chunks count="1"><chunk name="DefinitionObjects"><chunks count="0" /></chunk></chunks></chunk></chunks>
</Archive>`;

const sampleInputs: Record<string, JsonValue> = {
	gh_apply_graph: { widgets: [{ ref: "toggle", kind: "toggle", x: 20, y: 20, value: true }] },
	gh_create_widget: { items: [{ widgetType: "toggle", x: 20, y: 20, value: true }] },
	gh_edit_components: { items: [{ action: "delete", targetId: "component" }] },
	gh_edit_group: { items: [{ operation: "delete", groupName: "group" }] },
	gh_edit_param: { items: [{ action: "removeInput", targetId: "script", name: "x" }] },
	gh_edit_script: { items: [{ action: "create", x: 20, y: 20, language: "python", code: "a = 1" }] },
	gh_edit_wire: { items: [{ action: "connect", fromComponent: "a", fromPort: "b", toComponent: "c", toPort: "d" }] },
	gh_get_canvas: {},
	gh_get_canvas_errors: {},
	gh_list_components: { queries: ["addition"] },
	gh_mutate_widget: { items: [{ widgetType: "toggle", action: "setValue", targetId: "toggle", value: true }] },
	gh_param_rhino: { items: [{ action: "reference", targetId: "param", rhinoObjectIds: ["object"] }] },
	rh_capture_view: {},
	rh_query_objects: {},
	rh_run_script: { items: [{ mode: "command", source: "_SelNone" }] },
	rh_view_control: { action: "cplaneView" },
};

function queryResponse(request: JsonObject): JsonValue {
	switch (request.type) {
		case "getCurrentCanvas":
			return { type: "getCurrentCanvas.response", timestamp: 0, docName: "Test", xml: MINIMAL_ARCHIVE };
		case "getCanvasErrors":
			return { type: "getCanvasErrors.response", timestamp: 0, docName: "Test", errors: [] };
		case "listAllComponents":
			return { type: "listAllComponents.response", timestamp: 0, components: [] };
		case "listScriptParams":
			return { inputs: [], outputs: [] };
		case "getParamRhinoGeometry":
			return { targetId: "param", paramName: "Geometry", volatileItems: [], persistentItems: [] };
		case "getScriptCode":
			return { code: "a = 1" };
		case "queryRhinoObjects":
			return { type: "queryRhinoObjects.response", timestamp: 0, objects: [] };
		case "runRhinoScript":
			return { type: "runRhinoScript.response", timestamp: 0, ok: true, output: "", error: "" };
		case "controlRhinoView":
			return { ok: true, message: "View updated.", metadata: null };
		default:
			return {};
	}
}

function mockContext(reportProgress: OperationContext["reportProgress"]): OperationContext {
	return {
		signal: new AbortController().signal,
		requestId: "req_adapter_test",
		session: null,
		captureAllowed: false,
		backend: {
			query: async <T extends JsonValue>(request: JsonObject) => queryResponse(request) as T,
			executeActions: async () => ({
				outcome: "unknown",
				data: null,
				error: {
					code: "outcome_unknown",
					message: "Mock legacy queue outcome.",
					retryable: false,
				},
			}),
		},
		artifacts: {
			write: async () => ({
				artifactId: "artifact_test",
				kind: "diagnostic",
				path: "/tmp/hopper/test",
				mediaType: "application/octet-stream",
				byteLength: 0,
				sha256: "0".repeat(64),
			}),
		},
		reportProgress,
		now: () => new Date(0),
	};
}

test("every registry operation has one Pi adapter", () => {
	const tools = createPiOperationTools(() => mockContext(() => {}));
	const operationNames = createOperationRegistry().list().map((entry) => entry.name).sort();
	assert.deepEqual(Object.keys(tools).sort(), operationNames);
	assert.deepEqual(operationNames, HOPPER_OPERATIONS.map((operation) => operation.name).sort());
	assert.equal(new Set(Object.values(tools).map((tool) => tool.name)).size, 16);
});

test("every Pi adapter resolves valid input and invokes its operation with mocked context", async () => {
	let contextCalls = 0;
	const tools = createPiOperationTools((args) => {
		contextCalls++;
		return mockContext(args.reportProgress);
	});

	for (const operation of HOPPER_OPERATIONS) {
		const input = sampleInputs[operation.name];
		assert.ok(input, `Missing adapter parity input for ${operation.name}`);
		const definition = tools[operation.name] as unknown as {
			execute(...args: any[]): Promise<any>;
		};
		const result = await definition.execute(
			`call_${operation.name}`,
			input,
			new AbortController().signal,
			undefined,
			{} as never,
		);
		assert.equal(result.details.kind, "result", operation.name);
	}

	assert.equal(contextCalls, HOPPER_OPERATIONS.length);
});

test("adapter presentation preserves labels and capture prompts", () => {
	const tools = createPiOperationTools(() => mockContext(() => {}));
	assert.equal(tools.rh_run_script?.label, "Run Rhino Script");
	assert.equal(tools.gh_edit_param?.label, "Edit Script Ports");
	assert.equal(tools.rh_capture_view?.label, "Capture Rhino View");
	assert.equal(
		(tools.rh_capture_view as ToolDefinition & { promptSnippet?: string }).promptSnippet,
		"Capture a consent-gated Rhino viewport screenshot for visual QA",
	);
	assert.deepEqual(
		(tools.rh_capture_view as ToolDefinition & { promptGuidelines?: string[] }).promptGuidelines,
		[
			"Use rh_capture_view only when pixels materially help visual QA and Rhino screenshot consent is allowed.",
			"If rh_capture_view is unavailable or denied, continue with text and geometry tools instead of blocking the task.",
		],
	);
});
