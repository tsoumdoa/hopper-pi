import { parseImages, type ImageAttachment } from "../protocol.js";
import {
	validateTargetBinding,
	type TargetBinding,
} from "../../protocol/shared-execution.js";

export type SharedBrowserCommand =
	| { type: "authenticate"; token: string }
	| { type: "snapshot" }
	| { type: "create_conversation"; requestId: string; title: string }
	| {
			type: "submit";
			requestId: string;
			conversationId: string;
			sessionId: string;
			kind: "prompt" | "follow_up";
			text: string;
			bindings: TargetBinding[];
			messageTarget?: TargetBinding;
			attachments: ImageAttachment[];
	  }
	| {
			type: "steer";
			requestId: string;
			conversationId: string;
			taskId: string;
			sessionId: string;
			turnId: string;
			text: string;
			attachments: ImageAttachment[];
	  }
	| {
			type: "answer";
			requestId: string;
			conversationId: string;
			questionId: string;
			answer: string | null;
	  }
	| {
			type: "recover";
			requestId: string;
			conversationId: string;
			taskId: string;
			acknowledgement: string;
	  }
	| {
			type: "cancel";
			requestId: string;
			conversationId: string;
			taskId: string;
	  }
	| { type: "stop_host"; requestId: string; hostEpoch: string }
	| { type: "set_model"; provider: string; modelId: string }
	| { type: "set_thinking"; level: string }
	| { type: "logout"; provider: string }
	| {
			type: "login";
			provider: string;
			authType: "api_key" | "oauth";
			apiKey?: string;
	  }
	| {
			type: "auth_response";
			requestId: string;
			value: string | boolean | null;
	  };

function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Expected a command object");
	return value as Record<string, unknown>;
}
function string(
	value: Record<string, unknown>,
	key: string,
	empty = false,
): string {
	const result = value[key];
	if (
		typeof result !== "string" ||
		(!empty && !result.trim()) ||
		result.length > 1_048_576
	)
		throw new Error(`Invalid ${key}`);
	return result;
}
export function parseSharedBrowserCommand(raw: string): SharedBrowserCommand {
	const v = object(JSON.parse(raw));
	const type = string(v, "type");
	if (type === "authenticate") return { type, token: string(v, "token") };
	if (type === "snapshot") return { type };
	if (type === "set_model")
		return {
			type,
			provider: string(v, "provider"),
			modelId: string(v, "modelId"),
		};
	if (type === "set_thinking") return { type, level: string(v, "level") };
	if (type === "logout") return { type, provider: string(v, "provider") };
	if (type === "login") {
		if (v.authType !== "api_key" && v.authType !== "oauth")
			throw new Error("Invalid authentication method");
		return {
			type,
			provider: string(v, "provider"),
			authType: v.authType,
			...(v.apiKey === undefined ? {} : { apiKey: string(v, "apiKey") }),
		};
	}
	const requestId = string(v, "requestId");
	if (type === "auth_response") {
		if (
			v.value !== null &&
			typeof v.value !== "string" &&
			typeof v.value !== "boolean"
		)
			throw new Error("Invalid authentication response");
		return { type, requestId, value: v.value };
	}
	if (type === "stop_host")
		return { type, requestId, hostEpoch: string(v, "hostEpoch") };
	if (type === "create_conversation")
		return { type, requestId, title: string(v, "title") };
	const conversationId = string(v, "conversationId");
	if (type === "answer")
		return {
			type,
			requestId,
			conversationId,
			questionId: string(v, "questionId"),
			answer: v.answer === null ? null : string(v, "answer"),
		};
	if (type === "recover")
		return {
			type,
			requestId,
			conversationId,
			taskId: string(v, "taskId"),
			acknowledgement: string(v, "acknowledgement"),
		};
	if (type === "cancel")
		return { type, requestId, conversationId, taskId: string(v, "taskId") };
	const sessionId = string(v, "sessionId");
	const attachments = parseImages(v.attachments) ?? [];
	const text = string(v, "text", attachments.length > 0);
	if (type === "steer")
		return {
			type,
			requestId,
			conversationId,
			sessionId,
			taskId: string(v, "taskId"),
			turnId: string(v, "turnId"),
			text,
			attachments,
		};
	if (type === "submit") {
		if (v.kind !== "prompt" && v.kind !== "follow_up")
			throw new Error("Invalid submission kind");
		if (!Array.isArray(v.bindings))
			throw new Error("Expected connected document targets");
		const bindings = v.bindings.map((binding) => {
			const parsed = validateTargetBinding(binding);
			if (!parsed.ok) throw new Error(parsed.errors.join("; "));
			return parsed.value;
		});
		if (
			new Set(bindings.map((binding) => JSON.stringify(binding))).size !==
			bindings.length
		)
			throw new Error("Duplicate target selection");
		let messageTarget: TargetBinding | undefined;
		if (v.messageTarget !== undefined) {
			const parsed = validateTargetBinding(v.messageTarget);
			if (!parsed.ok) throw new Error(parsed.errors.join("; "));
			messageTarget = parsed.value;
			if (!bindings.some((binding) => JSON.stringify(binding) === JSON.stringify(messageTarget)))
				throw new Error("Message document must be included in instance access");
		}
		return {
			type,
			requestId,
			conversationId,
			sessionId,
			kind: v.kind,
			text,
			bindings,
			...(messageTarget ? { messageTarget } : {}),
			attachments,
		};
	}
	throw new Error(`Unknown shared command: ${type}`);
}
