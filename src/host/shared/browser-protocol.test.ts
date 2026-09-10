import { expect, it } from "vitest";
import { parseSharedBrowserCommand } from "./browser-protocol.js";
const submit = {
	type: "submit",
	requestId: "r",
	conversationId: "c",
	sessionId: "s",
	kind: "prompt",
	text: "Build",
	bindings: [],
	attachments: [],
};
it("requires stable identity and exact captured target shapes", () => {
	expect(parseSharedBrowserCommand(JSON.stringify(submit))).toEqual(submit);
	expect(() =>
		parseSharedBrowserCommand(
			JSON.stringify({ ...submit, requestId: undefined }),
		),
	).toThrow(/requestId/);
	expect(() =>
		parseSharedBrowserCommand(
			JSON.stringify({
				...submit,
				bindings: [
					{
						kind: "grasshopper",
						lifecycleInstanceId: "l",
						grasshopperDocumentId: "g",
					},
				],
			}),
		),
	).toThrow();
	const binding = {
		kind: "rhino",
		lifecycleInstanceId: "l",
		rhinoDocumentId: "d",
	};
	expect(() =>
		parseSharedBrowserCommand(
			JSON.stringify({ ...submit, bindings: [binding, binding] }),
		),
	).toThrow(/Duplicate/);
});
it("requires the active task, turn and session for steering", () => {
	expect(() =>
		parseSharedBrowserCommand(JSON.stringify({ ...submit, type: "steer" })),
	).toThrow(/taskId/);
	expect(
		parseSharedBrowserCommand(
			JSON.stringify({ ...submit, type: "steer", taskId: "t", turnId: "u" }),
		),
	).toMatchObject({ taskId: "t", turnId: "u", sessionId: "s" });
});
it("accepts picker cancellation without accepting malformed answers", () => {
	const command = { type: "answer", requestId: "r", conversationId: "c", questionId: "q", answer: null };
	expect(parseSharedBrowserCommand(JSON.stringify(command))).toEqual(command);
	for (const answer of [undefined, {}, [], false]) expect(() => parseSharedBrowserCommand(JSON.stringify({ ...command, answer }))).toThrow();
});

it("captures a message document separately from access to all connected documents", () => {
	const bindings = Array.from({ length: 20 }, (_, index) => ({ kind: "rhino", lifecycleInstanceId: `life-${index}`, rhinoDocumentId: `doc-${index}` }));
	const command = { ...submit, bindings, messageTarget: bindings[1] };
	expect(parseSharedBrowserCommand(JSON.stringify(command))).toEqual(command);
	expect(() => parseSharedBrowserCommand(JSON.stringify({ ...command, bindings: [bindings[0]] }))).toThrow("Message document must be included");
});

it("accepts a plain open request without document authorization", () => {
 expect(parseSharedBrowserCommand(JSON.stringify({ ...submit, text: "Open /models/next.3dm" }))).toEqual({ ...submit, text: "Open /models/next.3dm" });
});
