import type { HostSnapshot, ServerMessage, JsonValue, AgentToolsSnapshot } from "../host/protocol.js";
import { array, fields, string, number, boolean, optional, oneOf, nullable, object, type Reader } from "./browser-schema.js";
import { validateHistorySnapshot, readTarget, readConversationSession, type SharedSnapshot } from "./browser-snapshot.js";
import type { SnapshotPatch } from "./snapshot-patch.js";

const json: Reader<JsonValue> = value => {
	if (value === null || typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number") return number(value);
	if (Array.isArray(value)) return value.map(json);
	return Object.fromEntries(Object.entries(object(value)).map(([key, item]) => [key, json(item)]));
};
const model = fields({ provider: string, id: string, name: optional(string), input: optional(array(string)) });
const runtime: Reader<HostSnapshot> = fields({
	sessionId: string, sessionFile: optional(string), sessionName: optional(string), messages: array(json),
	streamingMessage: optional(json), isStreaming: boolean, model: optional(model), thinkingLevel: string,
	availableThinkingLevels: array(string), models: array(model), providers: array(fields({
		id: string, name: string, authenticated: boolean, authMethods: array(fields({ type: oneOf("api_key", "oauth"), label: string })),
		credentialSource: optional(string), credentialLabel: optional(string), canLogout: optional(boolean),
	})),
});
const toolStatus = oneOf("disabled-by-user", "parent-disabled", "api-key-required", "images-required", "backend-unavailable", "ui-unavailable", "settings-unavailable", "credential-store-unavailable", "available-on-demand", "activation-required", "active", "pending-exposure", "registration-conflict");
const toolSettings: Reader<AgentToolsSnapshot> = fields({
	context: optional(fields({ kind: oneOf("task", "target"), taskId: optional(string), label: string })),
	tools: array(fields({ name: string, description: string, parameters: json, active: boolean,
		id: optional(string), parent: optional(string), enabled: optional(boolean), available: optional(boolean), status: optional(toolStatus) })),
	settings: optional(fields({
		version: nullable(fields({ epoch: string, revision: number })), error: optional(string),
		parents: array(fields({ id: string, name: string, enabled: boolean, description: optional(string),
			credential: optional(fields({ label: string, notice: string, status: oneOf("configured", "missing", "unavailable") })) })),
	})),
});
const status = fields({
	hostEpoch: string, conversationSession: optional(readConversationSession), targets: array(readTarget), runtime,
});
/** Validate without replacing rows, preserving identities after a patch. */
export function validateSharedSnapshot(value: unknown): SharedSnapshot {
	validateHistorySnapshot(value);
	status(value);
	const source = object(value);
	number(source.eventCursor);
	if (source.historyStorage !== undefined) fields({ journalPath: string, sessionsPath: string })(source.historyStorage);
	return value as SharedSnapshot;
}
const commandResult = fields({ conversationId: optional(string), admissionError: optional(string), cleanupPending: optional(number) });
export type CommandAccepted = { type: "command_accepted"; requestId?: string; result?: (ReturnType<typeof commandResult> & Record<string, unknown>) | null };
export type SharedServerMessage =
	| { type: "shared_snapshot"; snapshot: SharedSnapshot }
	| { type: "shared_patch"; patch: SnapshotPatch }
	| ({ type: "shared_status" } & Pick<SharedSnapshot, "hostEpoch" | "conversationSession" | "targets" | "runtime">)
	| CommandAccepted
	| Extract<ServerMessage, { type: "error" | "auth_event" | "status" | "ui_request_cancelled" | "tool_settings" | "ui_request" | "ui_notification" }>;

const row = (value: unknown) => {
	const data = object(value);
	for (const field of Object.values(data)) {
		if (field !== null && typeof field !== "string" && typeof field !== "number") throw new Error("Invalid patch row");
		if (typeof field === "number") number(field);
	}
	if (typeof data.id !== "string" && typeof data.id !== "number") throw new Error("Missing patch row ID");
	return data as Record<string, string | number | null>;
};
const tables = new Set(["conversations", "sessions", "tasks", "turns", "events", "records", "recoveries", "questions", "inputs"]);
const readPatch = (value: unknown): SnapshotPatch => {
	const source = object(value), changes = object(source.changes);
	const patch: SnapshotPatch = { baseCursor: number(source.baseCursor), values: object(source.values), changes: {} };
	for (const [table, change] of Object.entries(changes)) {
		if (!tables.has(table)) throw new Error("Unknown snapshot table");
		Object.assign(patch.changes, { [table]: fields({ upsert: array(row), order: optional(array(string)) })(change) });
	}
	return patch;
};

/** Unknown message kinds are ignored for compatibility; known malformed messages fail. */
export function parseSharedServerMessage(raw: string): SharedServerMessage | undefined {
	const source = object(JSON.parse(raw));
	switch (source.type) {
		case "shared_snapshot": return { type: source.type, snapshot: validateSharedSnapshot(source.snapshot) };
		case "shared_status": return { type: source.type, ...status(source) };
		case "shared_patch": return { type: source.type, patch: readPatch(source.patch) };
		case "command_accepted": return { type: source.type, requestId: optional(string)(source.requestId), result: source.result == null ? source.result : { ...object(source.result), ...commandResult(source.result) } };
		case "error": return { type: source.type, ...fields({ message: string, requestId: optional(string), requestType: optional(string) })(source) };
		case "status": return { type: source.type, ...fields({ status: string, message: optional(string), scope: optional(string), provider: optional(string), streaming: optional(boolean) })(source) };
		case "auth_event": return { type: source.type, event: json(object(source.event)) };
		case "ui_request_cancelled": return { type: source.type, requestId: string(source.requestId) };
		case "ui_notification": return { type: source.type, ...fields({ message: string, level: oneOf("info", "warning", "error") })(source) };
		case "ui_request": return { type: source.type, ...fields({
			requestId: string, kind: oneOf("select", "confirm", "input", "editor", "auth"), title: string,
			options: optional(array(fields({ id: string, value: string, label: string, description: optional(string) }))),
			description: optional(string), placeholder: optional(string), prefill: optional(string), secret: optional(boolean),
		})(source) };
		case "tool_settings": return { type: source.type, snapshot: toolSettings(source.snapshot) };
		default: return undefined;
	}
}
