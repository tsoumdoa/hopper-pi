import assert from "node:assert/strict";
import { test } from "vitest";
import { describeModel, modelSupportsImages, parseProviderModel } from "./model-capabilities.js";

test("modelSupportsImages checks model input capabilities", () => {
	assert.equal(modelSupportsImages({ input: ["text", "image"] }), true);
	assert.equal(modelSupportsImages({ input: ["text"] }), false);
	assert.equal(modelSupportsImages(undefined), false);
});

test("parseProviderModel parses provider/model fallback ids", () => {
	assert.deepEqual(parseProviderModel("anthropic/claude-sonnet-4-5"), {
		provider: "anthropic",
		model: "claude-sonnet-4-5",
	});
	assert.equal(parseProviderModel("missing-slash"), null);
	assert.equal(parseProviderModel("provider/"), null);
});

test("describeModel formats selected model labels", () => {
	assert.equal(describeModel({ provider: "google", id: "gemini", input: ["text", "image"] }), "google/gemini");
	assert.equal(describeModel({ id: "local-model" }), "local-model");
	assert.equal(describeModel(null), "the selected model");
});
