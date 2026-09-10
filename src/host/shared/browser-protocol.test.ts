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
it("defaults a document replacement to preserving modified work", () => {
	const command = parseSharedBrowserCommand(
		JSON.stringify({
			...submit,
			documentAction: {
				lifecycleInstanceId: "rhino",
				kind: "rhino",
				action: "new",
			},
		}),
	);
	expect(command).toMatchObject({
		documentAction: { modifiedPolicy: "refuse" },
	});
	expect(
		(command as Extract<typeof command, { type: "submit" }>).documentAction,
	).not.toHaveProperty("overwrite");
});
it("captures an explicit save destination and overwrite permission exactly", () => {
	const documentAction = {
		lifecycleInstanceId: "rhino",
		kind: "rhino",
		action: "open",
		path: "/models/next.3dm",
		modifiedPolicy: "save",
		savePath: "/models/current-copy.3dm",
		overwrite: true,
	};
	expect(
		parseSharedBrowserCommand(JSON.stringify({ ...submit, documentAction })),
	).toMatchObject({ documentAction });
	expect(
		parseSharedBrowserCommand(
			JSON.stringify({
				...submit,
				documentAction: {
					...documentAction,
					savePath: undefined,
					overwrite: undefined,
				},
			}),
		),
	).toMatchObject({ documentAction: { modifiedPolicy: "save" } });
});
it("never retains save or overwrite authority when refusing or discarding changes", () => {
	for (const modifiedPolicy of ["refuse", "discard"]) {
		const documentAction = {
			lifecycleInstanceId: "rhino",
			kind: "rhino",
			action: "new",
			modifiedPolicy,
		};
		expect(
			parseSharedBrowserCommand(JSON.stringify({ ...submit, documentAction })),
		).toMatchObject({ documentAction });
		expect(() =>
			parseSharedBrowserCommand(
				JSON.stringify({
					...submit,
					documentAction: { ...documentAction, savePath: "/file.3dm" },
				}),
			),
		).toThrow("explicit save");
		expect(() =>
			parseSharedBrowserCommand(
				JSON.stringify({
					...submit,
					documentAction: { ...documentAction, overwrite: true },
				}),
			),
		).toThrow("explicit save");
	}
});
it("rejects ambiguous document policies and malformed open or overwrite values", () => {
	const base = { lifecycleInstanceId: "rhino", kind: "rhino", action: "new" };
	for (const documentAction of [
		{ ...base, modifiedPolicy: "automatic" },
		{ ...base, modifiedPolicy: "save", overwrite: "true" },
		{ ...base, action: "open" },
		{ ...base, path: "/ignored.3dm" },
	]) {
		expect(() =>
			parseSharedBrowserCommand(JSON.stringify({ ...submit, documentAction })),
		).toThrow();
	}
});
it("requires complete original launch scope and explicit recovery acknowledgement", () => {
	const command = {
		type: "recover_launch",
		requestId: "recovery",
		conversationId: "conversation",
		taskId: "task",
		launchRequestId: "launch",
		acknowledgement: "Inspected and closed original Rhino",
	};
	expect(parseSharedBrowserCommand(JSON.stringify(command))).toEqual(command);
	for (const key of [
		"requestId",
		"conversationId",
		"taskId",
		"launchRequestId",
		"acknowledgement",
	])
		expect(() =>
			parseSharedBrowserCommand(JSON.stringify({ ...command, [key]: " " })),
		).toThrow(key);
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
