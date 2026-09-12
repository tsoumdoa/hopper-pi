import { array, boolean, fields, nullable, oneOf, optional, readJson, string, unknown as unknownValue, type Reader, type ReadValue } from "./browser-schema.js";
import { readBinding } from "./browser-snapshot.js";

const emptyArray = <T>(read: Reader<T>): Reader<T[]> => value => value === undefined ? [] : array(read)(value);
const text = optional(string);
const taskInput = fields({
	text: value => value === undefined ? "" : string(value),
	bindings: emptyArray(readBinding), messageTarget: optional(readBinding),
	attachments: optional(unknownValue), kind: optional(oneOf("prompt", "follow_up", "steer")),
});
export function readTaskInput(value: unknown) {
	return readJson(value, taskInput, { text: "", bindings: [] });
}
const owner = nullable(fields({ binding: optional(readBinding) }));
export function readOwner(value: unknown) { return readJson(value, owner, null); }
const pickOption = fields({ label: string, value: string, description: text });
const question = fields({
	kind: text, question: text, placeholder: text,
	options: emptyArray(value => typeof value === "string" ? value : pickOption(value)),
});
export function readQuestionPayload(value: unknown) { return readJson(value, question, { options: [] }); }
const input = fields({ text: value => value === undefined ? "" : string(value), attachments: optional(unknownValue) });
export function readInputPayload(value: unknown) { return readJson(value, input, { text: "" }); }
const reason = fields({ reason: text });
export function readRecordReason(value: unknown) { return readJson(value, reason, {}).reason; }
export function readAnswer(value: unknown): unknown { return readJson(value, unknownValue, value); }

// Agent content varies by provider. Validate display fields while retaining opaque tool data.
const contentPart = fields({
	type: string, text, thinking: text, id: text, toolCallId: text, name: text,
	arguments: optional(unknownValue), data: text, mimeType: text,
});
const message = fields({
	role: string, content: value => typeof value === "string" ? [contentPart({ type: "text", text: value })] : emptyArray(contentPart)(value), toolCallId: text, toolName: text,
	details: optional(unknownValue), isError: optional(boolean),
});
export type BrowserMessage = ReadValue<typeof message>;
const toolCall = fields({ id: text, toolCallId: text, name: text, arguments: optional(unknownValue) });
const update = fields({ type: text, delta: text, text, id: text, toolName: text, toolCall: optional(toolCall) });
const event = fields({
	type: text, message: optional(message), assistantMessageEvent: optional(update),
	args: optional(unknownValue), partialResult: optional(unknownValue), result: optional(unknownValue),
	isError: optional(boolean),
});
const progress = fields({
	type: text, turnId: text, messageId: text, message: optional(message), messages: emptyArray(message),
	streaming: optional(boolean),
	event: optional(event), phase: text, toolCallId: text, toolName: text,
	args: optional(unknownValue), partialResult: optional(unknownValue), result: optional(unknownValue),
	isError: optional(boolean),
});
export function readProgress(value: unknown) { return readJson(value, progress, { messages: [] }); }
