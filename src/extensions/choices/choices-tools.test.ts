import assert from "node:assert/strict";
import { test } from "vitest";
import { registerAskUserTool } from "./register-ask-user.js";
import { registerPickOptionTool } from "./register-pick-option.js";

function captureRegisteredTool(register: (pi: any) => void): any {
	let tool: unknown;
	register({
		registerTool(registered: unknown) {
			tool = registered;
		},
	});
	return tool;
}

test("ask_user passes the question as the input title and forwards abort signal", async () => {
	const tool = captureRegisteredTool(registerAskUserTool);
	const controller = new AbortController();
	const calls: unknown[][] = [];

	const result = await tool.execute(
		"tool-call",
		{ question: "Which layer should I use?", placeholder: "Layer name" },
		controller.signal,
		undefined,
		{
			hasUI: true,
			ui: {
				input: async (...args: unknown[]) => {
					calls.push(args);
					return "  Walls  ";
				},
			},
		},
	);

	assert.equal(calls[0]?.[0], "Which layer should I use?");
	assert.equal(calls[0]?.[1], "Layer name");
	assert.equal((calls[0]?.[2] as { signal?: AbortSignal }).signal, controller.signal);
	assert.deepEqual(result.details, { question: "Which layer should I use?", answer: "Walls" });
});

test("pick_option forwards abort signal through select and custom Other input", async () => {
	const tool = captureRegisteredTool(registerPickOptionTool);
	const controller = new AbortController();
	const calls: unknown[][] = [];

	const result = await tool.execute(
		"tool-call",
		{
			question: "Choose scope",
			options: [
				{ label: "Canvas", value: "canvas" },
				{ label: "Rhino", value: "rhino" },
			],
		},
		controller.signal,
		undefined,
		{
			hasUI: true,
			ui: {
				select: async (...args: unknown[]) => {
					calls.push(["select", ...args]);
					return "Other";
				},
				input: async (...args: unknown[]) => {
					calls.push(["input", ...args]);
					return "current selection";
				},
			},
		},
	);

	assert.equal(calls[0]?.[0], "select");
	assert.equal((calls[0]?.[3] as { signal?: AbortSignal }).signal, controller.signal);
	assert.equal(calls[1]?.[0], "input");
	assert.equal((calls[1]?.[3] as { signal?: AbortSignal }).signal, controller.signal);
	assert.equal(result.details.value, "current selection");
});

test("pick_option rejects agent-provided canonical Other labels", async () => {
	const tool = captureRegisteredTool(registerPickOptionTool);

	await assert.rejects(
		tool.execute(
			"tool-call",
			{
				question: "Choose scope",
				options: [
					{ label: "Other", value: "other-token" },
					{ label: "Canvas", value: "canvas" },
				],
			},
			undefined,
			undefined,
			{ hasUI: true, ui: {} },
		),
		/pick_option reserves the "Other" label/,
	);
});
