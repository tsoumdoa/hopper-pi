import type { HostSnapshot } from "../host/protocol.js";
import { validateTargetBinding, type TargetBinding } from "./shared-execution.js";
import { array, fields, string, number, boolean, optional, nullable, oneOf, dictionary, jsonText, object, type Reader, type ReadValue } from "./browser-schema.js";

export const taskState = oneOf("queued", "running", "suspending", "awaiting_user", "completed", "cancelled", "interrupted", "failed", "uncertain");
export type TaskState = ReadValue<typeof taskState>;
const turnState = oneOf("queued", "running", "suspended", "completed", "cancelled", "interrupted", "failed", "uncertain");
const maybeNumber = optional(nullable(number)), maybeString = optional(nullable(string));
const maybeJson = optional(nullable(jsonText));

// Keep serialized payloads flat so unchanged rows compare by value in snapshot patches.
export const readConversation = fields({
	id: string, title: string, sequence: optional(number), created_at: optional(number),
	archived_at: maybeNumber, document_label: maybeString, last_activity_at: optional(number),
	live_state: optional(nullable(taskState)), document_target: maybeJson, last_message_target: maybeJson,
	recovery_required: optional(oneOf(0, 1)), instance_ids: optional(jsonText), recovery_instance_ids: optional(jsonText),
	first_user_text: maybeString,
});
export type ConversationSnapshot = ReadValue<typeof readConversation>;
export const readTask = fields({
	id: string, conversation_id: string, session_id: optional(string), payload: jsonText, state: taskState,
	parent_task_id: maybeString, root_task_id: maybeString, cancellation_requested: optional(oneOf(0, 1)),
	sequence: optional(number), created_at: optional(number), updated_at: optional(number),
});
export type TaskSnapshot = ReadValue<typeof readTask>;
export const readSession = fields({ id: string, conversation_id: string, created_at: optional(number) });
export const readTurn = fields({
	id: string, task_id: string, state: turnState, owner: maybeJson,
	cleanup_confirmed: optional(oneOf(0, 1)), usage: optional(number), created_at: optional(number), started_at: maybeNumber, ended_at: maybeNumber,
});
export type TurnSnapshot = ReadValue<typeof readTurn>;
export const readEvent = fields({ id: number, task_id: string, kind: string, payload: jsonText, created_at: optional(number) });
export type EventSnapshot = ReadValue<typeof readEvent>;
export const readQuestion = fields({
	id: string, task_id: string, turn_id: string, tool_call_id: optional(string), payload: jsonText,
	answer: nullable(string), continuation_id: maybeString,
});
export type QuestionSnapshot = ReadValue<typeof readQuestion>;
export const readInput = fields({
	id: number, task_id: string, turn_id: optional(string), payload: jsonText,
	state: oneOf("accepted", "delivering", "applied", "not_applied", "unknown"),
});
export const readRecovery = fields({ id: string, task_id: string, payload: jsonText });
export const readRecord = fields({ id: string, task_id: string, kind: string, payload: jsonText, state: string });
export const readHistory = fields({
	conversationId: nullable(string), before: nullable(number), hasOlder: boolean, oldestSequence: nullable(number), pageTaskIds: array(string),
});
function historyReader(row: <T>(read: Reader<T>) => Reader<T>) {
	return fields({
		conversations: array(row(readConversation)), sessions: array(row(readSession)), tasks: array(row(readTask)), turns: array(row(readTurn)),
		events: array(row(readEvent)), recoveries: array(row(readRecovery)), questions: array(row(readQuestion)),
		inputs: optional(array(row(readInput))), records: optional(array(row(readRecord))), history: optional(readHistory),
	});
}
export const readHistorySnapshot = historyReader(read => read);
// Browser rows are immutable: snapshot patches replace changed rows. Cache only
// successful validations so an unchanged payload is not reparsed on every token.
function cachedRow<T>(read: Reader<T>): Reader<T> {
	const cache = new WeakMap<object, { value: T }>();
	return value => {
		const source = object(value), prior = cache.get(source);
		if (prior) return prior.value;
		const parsed = read(source);
		cache.set(source, { value: parsed });
		return parsed;
	};
}
export const validateHistorySnapshot = historyReader(cachedRow);
export type HistorySnapshot = ReadValue<typeof readHistorySnapshot>;
export const readBinding: Reader<TargetBinding> = value => {
	const result = validateTargetBinding(value);
	if (!result.ok) throw new Error("Invalid document binding");
	return result.value;
};
export const readTarget = fields({
	label: string, lifecycleInstanceId: string, processId: number,
	admission: oneOf("ready", "recovering", "detached"), documents: array(readBinding),
	documentLabels: optional(dictionary(string)),
});
export type SharedTarget = ReadValue<typeof readTarget>;
export const readConversationSession = fields({ id: string, afterConversationSequence: number });
export type SharedSnapshot = HistorySnapshot & {
	historyStorage?: { journalPath: string; sessionsPath: string };
	hostEpoch: string;
	conversationSession?: ReadValue<typeof readConversationSession>;
	targets: SharedTarget[];
	runtime: HostSnapshot;
	eventCursor: number;
};
