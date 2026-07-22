import assert from "node:assert/strict";
import { test } from "vitest";
import {
	isGooConversionError,
} from "./python-tree-error-hints.js";
import { formatCanvasErrorsResponse } from "../tools/query-handlers.js";

test("isGooConversionError matches Grasshopper Goo conversion failures", () => {
	assert.equal(
		isGooConversionError("Data conversion failed from Goo to Geometry somewhere"),
		true,
	);
	assert.equal(
		isGooConversionError("Data conversion failed from Goo to Number"),
		true,
	);
	assert.equal(isGooConversionError("Invalid cast"), false);
});

test("formatCanvasErrorsResponse appends treehelpers hint on Goo conversion errors", () => {
	const response = formatCanvasErrorsResponse({
		type: "getCanvasErrors.response",
		timestamp: 0,
		docName: "test",
		errors: [
			{
				componentId: "abc",
				componentNickName: "Loft",
				level: "error",
				text: "Data conversion failed from Goo to Geometry somewhere",
			},
		],
	});

	const text = response.content[0].text;
	assert.match(text, /Data conversion failed from Goo to Geometry somewhere/);
	assert.match(text, /Python tree\/list hint/);
	assert.match(text, /list_to_tree/);
	assert.match(text, /tree_to_list/);
});

test("formatCanvasErrorsResponse omits hint when no Goo conversion errors", () => {
	const response = formatCanvasErrorsResponse({
		type: "getCanvasErrors.response",
		timestamp: 0,
		docName: "test",
		errors: [
			{
				componentId: "abc",
				componentNickName: "Panel",
				level: "warning",
				text: "Empty list",
			},
		],
	});

	const text = response.content[0].text;
	assert.doesNotMatch(text, /Python tree\/list hint/);
});
