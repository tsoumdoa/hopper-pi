export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type UiRequestKind = "select" | "confirm" | "input" | "editor" | "auth";

export type UiRequestMessage = {
	type: "ui_request";
	requestId: string;
	kind: UiRequestKind;
	title: string;
	options?: Array<{ id: string; value: string; label: string; description?: string }>;
	description?: string;
	placeholder?: string;
	prefill?: string;
	secret?: boolean;
};

export type ProviderAuthMethod = {
	type: "api_key" | "oauth";
	label: string;
};

export type ProviderSummary = {
	id: string;
	name: string;
	authenticated: boolean;
	authMethods: ProviderAuthMethod[];
};

export type HostSnapshot = {
	sessionId: string;
	sessionFile?: string;
	sessionName?: string;
	messages: JsonValue[];
	isStreaming: boolean;
	model?: { provider: string; id: string; name?: string };
	thinkingLevel: string;
	availableThinkingLevels: string[];
	models: Array<{ provider: string; id: string; name?: string }>;
	providers: ProviderSummary[];
};

export type ServerMessage =
	| { type: "snapshot"; snapshot: HostSnapshot }
	| { type: "agent_event"; event: JsonValue }
	| UiRequestMessage
	| { type: "ui_notification"; message: string; level: "info" | "warning" | "error" }
	| { type: "ui_status"; key: string; text?: string }
	| { type: "ui_widget"; key: string; lines?: string[]; placement?: string }
	| { type: "auth_event"; event: JsonValue }
	| { type: "status"; status: string; message?: string; scope?: string; provider?: string; streaming?: boolean }
	| { type: "session_replaced"; session: HostSnapshot }
	| { type: "error"; requestType?: string; message: string };

export type ClientMessage =
	| { type: "authenticate"; token: string }
	| { type: "prompt"; text: string }
	| { type: "steer"; text: string }
	| { type: "follow_up"; text: string }
	| { type: "abort" }
	| { type: "new_session" }
	| { type: "set_model"; provider: string; id: string }
	| { type: "set_thinking"; level: string }
	| { type: "ui_response"; requestId: string; value: string | boolean | null }
	| { type: "login"; provider: string; authType: "api_key" | "oauth"; apiKey?: string }
	| { type: "logout"; provider: string }
	| { type: "snapshot" }
	| { type: "shutdown" };

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, key: string): string {
	const field = value[key];
	if (typeof field !== "string" || !field.trim()) throw new Error(`${key} must be a non-empty string`);
	return field;
}

export function parseClientMessage(input: string): ClientMessage {
	let value: unknown;
	try {
		value = JSON.parse(input);
	} catch {
		throw new Error("Message must be valid JSON");
	}
	if (!isRecord(value) || typeof value.type !== "string") {
		throw new Error("Message must be an object with a type");
	}

	switch (value.type) {
		case "authenticate":
			return { type: value.type, token: stringField(value, "token") };
		case "prompt":
		case "steer":
		case "follow_up":
			return { type: value.type, text: stringField(value, "text") };
		case "abort":
		case "new_session":
		case "snapshot":
		case "shutdown":
			return { type: value.type };
		case "set_model":
			return {
				type: value.type,
				provider: stringField(value, "provider"),
				id: typeof value.id === "string" && value.id.trim() ? value.id : stringField(value, "modelId"),
			};
		case "set_thinking":
			return { type: value.type, level: stringField(value, "level") };
		case "login": {
			const authType = value.authType;
			if (authType !== "api_key" && authType !== "oauth") {
				throw new Error("authType must be api_key or oauth");
			}
			const apiKey = value.apiKey;
			if (apiKey !== undefined && (typeof apiKey !== "string" || !apiKey.trim())) {
				throw new Error("apiKey must be a non-empty string");
			}
			return { type: value.type, provider: stringField(value, "provider"), authType, apiKey };
		}
		case "logout":
			return { type: value.type, provider: stringField(value, "provider") };
		case "ui_response": {
			const responseValue = value.cancelled === true ? null : (value.value ?? value.result ?? null);
			if (responseValue !== null && typeof responseValue !== "string" && typeof responseValue !== "boolean") {
				throw new Error("value must be a string, boolean, or null");
			}
			return { type: value.type, requestId: stringField(value, "requestId"), value: responseValue };
		}
		default:
			throw new Error(`Unknown message type: ${value.type}`);
	}
}
