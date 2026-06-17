import assert from "node:assert/strict";
import { test } from "vitest";
import { validateRhViewControlParams } from "./rh-view-control.js";

test("rh_view_control validation accepts supported view operations", () => {
	assert.equal(validateRhViewControlParams({ action: "setActiveView", viewName: "Perspective" }), null);
	assert.equal(validateRhViewControlParams({ action: "standardView", standardView: "top" }), null);
	assert.equal(validateRhViewControlParams({ action: "namedView", namedView: "Hero View" }), null);
	assert.equal(validateRhViewControlParams({ action: "cplaneView" }), null);
	assert.equal(
		validateRhViewControlParams({
			action: "camera",
			camera: {
				location: { x: 10, y: 20, z: 30 },
				target: { x: 0, y: 0, z: 0 },
				lensLength: 35,
				projection: "perspective",
			},
		}),
		null,
	);
	assert.equal(validateRhViewControlParams({ action: "zoom", zoom: { mode: "selected" } }), null);
	assert.equal(validateRhViewControlParams({ action: "saveNamedView", namedView: "Review View" }), null);
});

test("rh_view_control validation rejects invalid action-specific params", () => {
	assert.match(validateRhViewControlParams({ action: "setActiveView" }) ?? "", /viewName/);
	assert.match(validateRhViewControlParams({ action: "standardView", standardView: "diagonal" }) ?? "", /unsupported/);
	assert.match(validateRhViewControlParams({ action: "namedView" }) ?? "", /namedView/);
	assert.match(validateRhViewControlParams({ action: "camera", camera: {} }) ?? "", /at least one/);
	assert.match(
		validateRhViewControlParams({
			action: "camera",
			camera: { location: { x: 1, y: Number.NaN, z: 0 } },
		}) ?? "",
		/location/,
	);
	assert.match(
		validateRhViewControlParams({
			action: "zoom",
			zoom: { mode: "boundingBox", min: { x: 0, y: 0, z: 0 } },
		}) ?? "",
		/boundingBox/,
	);
	assert.match(validateRhViewControlParams({ action: "saveNamedView" }) ?? "", /namedView/);
});
