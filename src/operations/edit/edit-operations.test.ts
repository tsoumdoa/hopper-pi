import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import { test } from "vitest";
import type { JsonObject } from "../../core/contracts.js";
import type { OperationContext } from "../../core/operations.js";
import { PR1_INPUT_SCHEMA_GOLDEN } from "../../contracts/pr1-operation-input-schema-golden.js";
import { ghCreateWidgetOperation } from "./gh-create-widget.js";
import { ghEditComponentsOperation } from "./gh-edit-components.js";
import { ghEditGroupOperation } from "./gh-edit-group.js";
import { ghEditWireOperation } from "./gh-edit-wire.js";
import { ghMutateWidgetOperation } from "./gh-mutate-widget.js";
import { finishItemMutation, ItemOperationDataSchema } from "./shared.js";

const operations = [
	ghCreateWidgetOperation,
	ghMutateWidgetOperation,
	ghEditComponentsOperation,
	ghEditWireOperation,
	ghEditGroupOperation,
];

function context(executeActions?: (request: JsonObject) => Promise<any>): OperationContext {
	return {
		signal: new AbortController().signal,
		requestId: "req_test",
		session: null,
		backend: {
			query: async () => ({} as never),
			executeActions: executeActions ?? (async () => ({
				outcome: "succeeded",
				data: null,
				error: null,
			})),
		},
		artifacts: {
			write: async () => ({
				artifactId: "artifact_test",
				kind: "diagnostic",
				path: "artifact",
				mediaType: "application/octet-stream",
				byteLength: 0,
				sha256: "0".repeat(64),
			}),
		},
		reportProgress: () => {},
		now: () => new Date(0),
	};
}

test("edit operations preserve their frozen input schemas and Grasshopper scope", () => {
	for (const operation of operations) {
		const json = JSON.stringify(operation.inputSchema);
		const golden = PR1_INPUT_SCHEMA_GOLDEN[
			operation.name as keyof typeof PR1_INPUT_SCHEMA_GOLDEN
		];
		assert.equal(Buffer.byteLength(json), golden.byteLength, `${operation.name} bytes`);
		assert.equal(
			createHash("sha256").update(json).digest("hex"),
			golden.sha256,
			`${operation.name} schema`,
		);
		assert.deepEqual(operation.possibleScopes, ["grasshopper"]);
		assert.equal(operation.classifyScope({ items: [] } as never), "grasshopper");
		assert.ok(operation.prepareMutation, `${operation.name} must be batchable`);
	}
});

test("edit operations expose structured ItemOperationData", () => {
	const valid = {
		items: [{
			index: 0,
			action: "moveComponent",
			outcome: "succeeded",
			message: "Moved.",
			data: null,
			error: null,
		}],
	};
	assert.equal(Value.Check(ItemOperationDataSchema, valid), true);
	assert.equal(Value.Check(ItemOperationDataSchema, { items: [{ action: "moveComponent" }] }), false);
	for (const operation of operations) {
		assert.equal(Value.Check(operation.outputSchema, valid), true, operation.name);
	}
});

test("widget operations map every item to its backend command", async () => {
	const create = await ghCreateWidgetOperation.prepareMutation!({ items: [
		{ widgetType: "slider", x: 10, y: 20, min: 0, max: 5, value: 2, digits: 1 },
		{ widgetType: "panel", x: 30, y: 40, text: "secret", textOutput: "singleString" },
		{ widgetType: "toggle", x: 50, y: 60, value: true },
		{ widgetType: "swatch", x: 70, y: 80, color: "rgba(1,2,3,4)" },
		{ widgetType: "scribble", x: 90, y: 100, text: "note" },
		{ widgetType: "valueList", x: 110, y: 120, items: [{ name: "n", value: "v" }] },
	]}, context());
	assert.deepEqual(create.actions.map((action) => (action.command as JsonObject).action), [
		"createSlider", "createPanel", "createToggle", "createSwatch", "createScribble", "createValueList",
	]);
	assert.deepEqual(create.actions[0], {
		kind: "command",
		command: {
			action: "createSlider",
			params: { position: { x: 10, y: 20 }, min: 0, max: 5, value: 2, digits: 1 },
		},
	});

	const mutate = await ghMutateWidgetOperation.prepareMutation!({ items: [
		{ widgetType: "slider", action: "setValue", targetId: "a", value: 1 },
		{ widgetType: "slider", action: "setRange", targetId: "b", min: 0, max: 10, digits: 2 },
		{ widgetType: "panel", action: "setText", targetId: "c", text: "secret" },
		{ widgetType: "panel", action: "setProperty", targetId: "d", textOutput: "oneItemPerLine" },
		{ widgetType: "toggle", action: "setValue", targetId: "e", value: false },
		{ widgetType: "swatch", action: "setColor", targetId: "f", color: "rgba(1,2,3,4)" },
		{ widgetType: "scribble", action: "setText", targetId: "g", text: "secret" },
		{ widgetType: "valueList", action: "setSelected", targetId: "h", selectedIndex: 1 },
	]}, context());
	assert.deepEqual(mutate.actions.map((action) => (action.command as JsonObject).action), [
		"setSliderValue", "editSliderRange", "setPanelText", "setPanelParams",
		"setToggleValue", "setSwatchColor", "setScribbleText", "setValueListSelected",
	]);
});

test("component, wire, and group operations preserve command mappings", async () => {
	const components = await ghEditComponentsOperation.prepareMutation!({ items: [
		{ action: "add", componentType: "type", x: 25, y: 30 },
		{ action: "delete", targetId: "delete-id" },
		{ action: "move", targetId: "move-id", x: 40, y: 50 },
		{ action: "rename", targetId: "rename-id", nickName: "new name" },
		{ action: "set_locked", targetId: "lock-id", locked: true },
		{ action: "set_hidden", targetId: "hide-id", hidden: false },
	]}, context());
	assert.deepEqual(components.actions.map((action) => (action.command as JsonObject).action), [
		"addComponent", "deleteComponent", "moveComponent", "renameComponent",
		"setComponentLocked", "setComponentHidden",
	]);
	assert.deepEqual(components.actions[0], {
		kind: "command",
		command: {
			action: "addComponent",
			params: { typeGuid: "type", position: { x: 25, y: 30 }, preview: false },
		},
	});

	const wires = await ghEditWireOperation.prepareMutation!({ items: [
		{ action: "connect", fromComponent: "a", fromPort: "b", toComponent: "c", toPort: "d" },
		{ action: "disconnect", fromComponent: "e", fromPort: "f", toComponent: "g", toPort: "h" },
	]}, context());
	assert.deepEqual(wires.actions.map((action) => (action.command as JsonObject).action), ["connectWire", "disconnectWire"]);
	assert.deepEqual(wires.actions[0], {
		kind: "command",
		command: {
			action: "connectWire",
			params: {
				from: { componentId: "a", port: "b" },
				to: { componentId: "c", port: "d" },
			},
		},
	});

	const groups = await ghEditGroupOperation.prepareMutation!({ items: [
		{ operation: "add", componentIds: [" a "], groupName: "one" },
		{ operation: "remove", componentIds: ["b"], groupName: "two" },
		{ operation: "delete", groupName: "three" },
		{ operation: "changeColor", groupName: "four", color: "red" },
		{ operation: "rename", groupName: "five", name: "six" },
		{ operation: "changeStyle", groupName: "seven", border: "Blob" },
	]}, context());
	assert.deepEqual(groups.actions.map((action) => (action.command as JsonObject).action), [
		"addGroup", "removeFromGroup", "deleteGroup", "changeGroupColor", "renameGroup", "changeGroupStyle",
	]);
	assert.deepEqual(groups.actions[0], {
		kind: "command",
		command: {
			action: "addGroup",
			params: {
				componentIds: ["a"],
				groupName: "one",
				color: "rgba(255,255,255,150)",
			},
		},
	});
});

test("execute sends prepared actions and returns structured item results", async () => {
	let captured: JsonObject | undefined;
	const result = await ghEditWireOperation.execute({ items: [{
		action: "connect",
		fromComponent: "a",
		fromPort: "b",
		toComponent: "c",
		toPort: "d",
	}] }, context(async (request) => {
		captured = request;
		return { outcome: "succeeded", data: null, error: null };
	}));
	assert.equal((captured?.actions as unknown[]).length, 1);
	assert.equal(result.outcome, "succeeded");
	assert.equal(result.error, null);
	assert.equal(result.data?.items[0].action, "connectWire");
	assert.equal(result.data?.items[0].outcome, "succeeded");
});

test("maps executeActions action records without losing per-action outcomes", () => {
	const backendError = {
		code: "operation_failed" as const,
		message: "Move failed.",
		retryable: false,
	};
	const result = finishItemMutation({
		outcome: "partial",
		data: {
			payloadSha256: "digest",
			actions: [
				{
					index: 0,
					kind: "command",
					action: "deleteComponent",
					outcome: "succeeded",
					message: "Deleted.",
					data: { deletedId: "one" },
					error: null,
					elapsedMs: 2,
				},
				{
					index: 1,
					kind: "command",
					action: "moveComponent",
					outcome: "failed",
					message: "Move failed.",
					data: null,
					error: backendError,
					elapsedMs: 3,
				},
			],
		},
		error: {
			code: "partial_mutation",
			message: "One action failed.",
			retryable: false,
		},
	}, [
		{ action: "deleteComponent", targetId: "one" },
		{ action: "moveComponent", targetId: "two" },
	]);

	assert.deepEqual(result.data?.items, [
		{
			index: 0,
			action: "deleteComponent",
			targetId: "one",
			outcome: "succeeded",
			message: "Deleted.",
			data: { deletedId: "one" },
			error: null,
		},
		{
			index: 1,
			action: "moveComponent",
			targetId: "two",
			outcome: "failed",
			message: "Move failed.",
			data: null,
			error: backendError,
		},
	]);
});

test("keeps current item results and does not invent item states for unknown", () => {
	const currentItems = {
		items: [{
			index: 0,
			action: "deleteComponent",
			outcome: "failed" as const,
			message: "Rejected.",
			data: null,
			error: { code: "operation_failed" as const, message: "Rejected.", retryable: false },
		}],
	};
	const current = finishItemMutation({
		outcome: "failed",
		data: currentItems,
		error: currentItems.items[0].error,
	}, [{ action: "deleteComponent" }]);
	assert.equal(current.data, currentItems);

	const unknown = finishItemMutation({
		outcome: "unknown",
		data: { submittedJobIds: ["job-1"] },
		error: { code: "outcome_unknown", message: "May have run.", retryable: false },
	}, [{ action: "deleteComponent" }]);
	assert.equal(unknown.data, null);
});

test("summaries retain routing facts and redact raw widget content", () => {
	const createSummary = ghCreateWidgetOperation.summarizeInput({ items: [{
		widgetType: "panel",
		x: 10,
		y: 20,
		nickName: "private nickname",
		text: "private panel text",
		textOutput: "singleString",
		bgColor: "private color",
	}] });
	const mutateSummary = ghMutateWidgetOperation.summarizeInput({ items: [{
		widgetType: "scribble",
		action: "setText",
		targetId: "target",
		text: "private scribble text",
	}] });
	const componentSummary = ghEditComponentsOperation.summarizeInput({ items: [{
		action: "rename",
		targetId: "target",
		nickName: "private renamed value",
	}] });
	const groupSummary = ghEditGroupOperation.summarizeInput({ items: [{
		operation: "changeColor",
		groupName: "target group",
		color: "private color",
	}] });

	const serialized = JSON.stringify([
		createSummary,
		mutateSummary,
		componentSummary,
		groupSummary,
	]);
	for (const secret of [
		"private nickname",
		"private panel text",
		"private scribble text",
		"private renamed value",
		"private color",
	]) {
		assert.doesNotMatch(serialized, new RegExp(secret));
	}
	assert.match(serialized, /target/);
	assert.match(serialized, /setText/);
});
