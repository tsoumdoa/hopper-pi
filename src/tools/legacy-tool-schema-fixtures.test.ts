import assert from "node:assert/strict";
import { test } from "vitest";
import { ALL_TOOLS } from "./index.js";

type JsonSchema = {
	type?: string;
	const?: unknown;
	anyOf?: JsonSchema[];
	allOf?: JsonSchema[];
	properties?: Record<string, JsonSchema>;
	required?: string[];
	items?: JsonSchema;
};

function accepts(schema: JsonSchema, value: unknown): boolean {
	if (schema.const !== undefined) return value === schema.const;
	if (schema.anyOf) return schema.anyOf.some((candidate) => accepts(candidate, value));
	if (schema.allOf) return schema.allOf.every((candidate) => accepts(candidate, value));
	if (schema.type === "object") {
		if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
		const record = value as Record<string, unknown>;
		if ((schema.required ?? []).some((key) => !(key in record))) return false;
		return Object.entries(record).every(([key, child]) =>
			schema.properties?.[key] ? accepts(schema.properties[key], child) : true
		);
	}
	if (schema.type === "array") {
		return Array.isArray(value) && value.every((item) => accepts(schema.items ?? {}, item));
	}
	if (schema.type === "string") return typeof value === "string";
	if (schema.type === "number" || schema.type === "integer") return typeof value === "number";
	if (schema.type === "boolean") return typeof value === "boolean";
	return true;
}

const fixtures: Record<string, unknown[]> = {
	gh_edit_components: [
		{ items: [{ action: "add", componentType: "abcd", x: 100, y: 100, preview: false }] },
		{ items: [{ action: "delete", targetId: "abcd" }] },
		{ items: [{ action: "move", targetId: "abcd", x: 200, y: 200 }] },
		{ items: [{ action: "rename", targetId: "abcd", nickName: "Result" }] },
		{ items: [{ action: "set_locked", targetId: "abcd", locked: true }] },
		{ items: [{ action: "set_hidden", targetId: "abcd", hidden: true }] },
	],
	gh_create_widget: [
		{ items: [{ widgetType: "slider", x: 100, y: 100, min: 0, max: 10, value: 5, digits: 2 }] },
		{ items: [{ widgetType: "panel", x: 100, y: 100, text: "a", textOutput: "singleString" }] },
		{ items: [{ widgetType: "toggle", x: 100, y: 100, value: true }] },
		{ items: [{ widgetType: "swatch", x: 100, y: 100, color: "rgba(1,2,3,255)" }] },
		{ items: [{ widgetType: "scribble", x: 100, y: 100, text: "note" }] },
		{ items: [{ widgetType: "valueList", x: 100, y: 100, items: [{ name: "One", value: "1" }] }] },
	],
	gh_mutate_widget: [
		{ items: [{ widgetType: "slider", action: "setValue", targetId: "abcd", value: 3 }] },
		{ items: [{ widgetType: "slider", action: "setRange", targetId: "abcd", min: 0, max: 5, digits: 2 }] },
		{ items: [{ widgetType: "panel", action: "setText", targetId: "abcd", text: "next" }] },
		{ items: [{ widgetType: "panel", action: "setProperty", targetId: "abcd", textOutput: "singleString" }] },
		{ items: [{ widgetType: "toggle", action: "setValue", targetId: "abcd", value: false }] },
		{ items: [{ widgetType: "swatch", action: "setColor", targetId: "abcd", color: "rgba(1,2,3,255)" }] },
		{ items: [{ widgetType: "scribble", action: "setText", targetId: "abcd", text: "next" }] },
		{ items: [{ widgetType: "valueList", action: "setSelected", targetId: "abcd", selectedIndex: 0 }] },
	],
	gh_edit_param: [
		{ items: [{ action: "listParams", targetId: "abcd" }] },
		{ items: [{ action: "addInput", targetId: "abcd", name: "x", typeHint: "double", access: "item" }] },
		{ items: [{ action: "removeInput", targetId: "abcd", name: "x" }] },
		{ items: [{ action: "addOutput", targetId: "abcd", name: "A", typeHint: "object" }] },
		{ items: [{ action: "removeOutput", targetId: "abcd", name: "A" }] },
		{ items: [{ action: "editAccessType", targetId: "abcd", name: "x", access: "list" }] },
		{ items: [{ action: "syncParams", targetId: "abcd", inputs: [], outputs: [{ name: "A" }] }] },
	],
	gh_edit_script: [
		{ items: [{ action: "create", x: 100, y: 100, language: "python", code: "a=x" }] },
		{ items: [{ action: "setCode", targetId: "abcd", scriptParts: { runScript: "private void RunScript() {}" } }] },
		{ items: [{ action: "patchCode", targetId: "abcd", patches: [{ op: "delete", startLine: 1, endLine: 1 }] }] },
		{ items: [{ action: "getCode", targetId: "abcd" }] },
		{ items: [{ action: "getCodeParts", targetId: "abcd" }] },
	],
	gh_edit_group: [
		{ items: [{ operation: "add", componentIds: ["abcd"], groupName: "Graph", border: "Box" }] },
		{ items: [{ operation: "remove", componentIds: ["abcd"], groupName: "Graph" }] },
		{ items: [{ operation: "delete", groupName: "Graph" }] },
		{ items: [{ operation: "changeColor", groupName: "Graph", color: "rgba(1,2,3,255)" }] },
		{ items: [{ operation: "rename", groupName: "Graph", name: "Result" }] },
		{ items: [{ operation: "changeStyle", groupName: "Graph", border: "Rectangles" }] },
	],
	gh_edit_wire: [
		{ items: [{ action: "connect", fromComponent: "a", fromPort: "b", toComponent: "c", toPort: "d" }] },
		{ items: [{ action: "disconnect", fromComponent: "a", fromPort: "b", toComponent: "c", toPort: "d" }] },
	],
	gh_param_rhino: [
		{ items: [{ action: "get", targetId: "abcd" }] },
		{ items: [{ action: "reference", targetId: "abcd", rhinoObjectIds: ["efgh"] }] },
		{ items: [{ action: "internalize", targetId: "abcd", rhinoQuery: { layer: "Input" } }] },
	],
};

test("representative legacy tool-call shapes remain schema-valid", () => {
	const tools = new Map(ALL_TOOLS.map((tool) => [tool.name, tool]));
	for (const [name, calls] of Object.entries(fixtures)) {
		const tool = tools.get(name);
		assert.ok(tool, `missing ${name}`);
		for (const call of calls) {
			assert.ok(accepts(tool.parameters as JsonSchema, call), `${name} rejected ${JSON.stringify(call)}`);
		}
	}
});
