import assert from "node:assert/strict";
import { test } from "vitest";
import {
	collectToolSchemaMetrics,
	formatToolSchemaMetrics,
	serializedToolSchemaBytes,
} from "./tool-schema-metrics.js";
import { ALL_TOOLS } from "./catalog.js";

test("serializedToolSchemaBytes counts compact JSON", () => {
	const tool = {
		name: "demo",
		description: "hello",
		parameters: { type: "object", properties: {} },
	};
	const sizes = serializedToolSchemaBytes(tool);
	assert.ok(sizes.bytes > 0);
	assert.ok(sizes.parameterBytes > 0);
	assert.equal(sizes.descriptionBytes, Buffer.byteLength("hello", "utf8"));
});

test("collectToolSchemaMetrics reports groups and heavy tools", () => {
	const report = collectToolSchemaMetrics();
	assert.ok(report.totalCount >= ALL_TOOLS.length);
	assert.ok(report.totalBytes > 0);
	assert.ok(report.coreBytes > 0);
	assert.ok(report.coreBytes < report.totalBytes);
	assert.ok(report.byGroup.some((g) => g.group === "gh-script"));

	const names = report.tools.map((t) => t.name);
	assert.ok(names.includes("gh_edit_script"));
	assert.ok(names.includes("gh_edit_param"));
	assert.ok(names.includes("rh_capture_view"));
	assert.ok(names.includes("gh_apply_graph"));

	const heaviest = report.tools[0];
	assert.ok(heaviest);
	assert.ok(["gh_edit_script", "gh_edit_param", "gh_param_rhino"].includes(heaviest.name));

	const formatted = formatToolSchemaMetrics(report);
	assert.match(formatted, /Hopper tool schemas:/);
	assert.match(formatted, /By group:/);
	assert.match(formatted, /gh_edit_script/);
});
