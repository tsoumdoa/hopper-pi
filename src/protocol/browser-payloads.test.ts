import { describe, expect, it } from "vitest";
import { readInputPayload, readOwner, readProgress, readQuestionPayload, readTaskInput } from "./browser-payloads.js";

const json = JSON.stringify;
describe("browser payload readers", () => {
	it("provides safe defaults for invalid JSON and wrongly typed display data", () => {
		expect(readTaskInput("{")).toEqual({ text: "", bindings: [] });
		expect(readTaskInput(json({ text: {}, bindings: [] }))).toEqual({ text: "", bindings: [] });
		expect(readOwner(json({ binding: { documentId: "incomplete" } }))).toBeNull();
		expect(readInputPayload(json({ text: ["wrong"] }))).toEqual({ text: "" });
		expect(readQuestionPayload(json({ options: [null] }))).toEqual({ options: [] });
		expect(readProgress(json({ type: "messages", messages: {} }))).toEqual({ messages: [] });
	});
	it("keeps legacy string content and tool details while validating assistant text", () => {
		const payload = readProgress(json({ type: "messages", messages: [
			{ role: "user", content: "Build it" },
			{ role: "assistant", content: [{ type: "thinking", text: "Thinking" }, { type: "text", text: "Done" }] },
			{ role: "toolResult", toolCallId: "call", toolName: "capture", content: [{ type: "image", data: "abc", mimeType: "image/png" }], details: { custom: [1, 2] } },
		] }));
		expect(payload.messages).toHaveLength(3);
		expect(payload.messages[0]?.content).toEqual([{ type: "text", text: "Build it" }]);
		expect(payload.messages[2]?.content[0]).toEqual({ type: "image", data: "abc", mimeType: "image/png" });
		expect(payload.messages[2]?.details).toEqual({ custom: [1, 2] });
	});
	it("accepts plain and described question choices", () => {
		expect(readQuestionPayload(json({ kind: "pick_option", question: "Which?", options: ["A", { label: "B", value: "b", description: "Second" }] })))
			.toEqual({ kind: "pick_option", question: "Which?", options: ["A", { label: "B", value: "b", description: "Second" }] });
	});
});
