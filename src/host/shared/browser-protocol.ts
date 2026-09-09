import { parseImages, type ImageAttachment } from "../protocol.js";
import {
	validateTargetBinding,
	type TargetBinding,
} from "../../protocol/shared-execution.js";

export type NextDocumentAction = {
	lifecycleInstanceId: string;
	kind: "rhino" | "grasshopper";
	action: "new" | "open";
	path?: string;
	modifiedPolicy: "refuse" | "save" | "discard";
	savePath?: string;
	overwrite?: boolean;
};

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
			attachments: ImageAttachment[];
			documentAction?: NextDocumentAction;
			launch?: { installationId: string; independentProcess: boolean };
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
			type: "recover_launch";
			requestId: string;
			conversationId: string;
			taskId: string;
			launchRequestId: string;
			acknowledgement: string;
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
	if (type === "recover_launch")
		return {
			type,
			requestId,
			conversationId,
			taskId: string(v, "taskId"),
			launchRequestId: string(v, "launchRequestId"),
			acknowledgement: string(v, "acknowledgement"),
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
		if (!Array.isArray(v.bindings) || v.bindings.length > 16)
			throw new Error("Select up to 16 targets");
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
		let documentAction: Extract<
			SharedBrowserCommand,
			{ type: "submit" }
		>["documentAction"];
		if (v.documentAction !== undefined) {
			const action = object(v.documentAction);
			if (
				!["rhino", "grasshopper"].includes(String(action.kind)) ||
				!["new", "open"].includes(String(action.action))
			)
				throw new Error("Invalid document action");
			const modifiedPolicy = action.modifiedPolicy ?? "refuse";
			if (!["refuse", "save", "discard"].includes(String(modifiedPolicy)))
				throw new Error("Invalid modified document policy");
			if (action.action === "open" && action.path === undefined)
				throw new Error("Open action requires a path");
			if (action.action === "new" && action.path !== undefined)
				throw new Error("New action does not accept an open path");
			if (
				modifiedPolicy !== "save" &&
				(action.savePath !== undefined || action.overwrite !== undefined)
			)
				throw new Error(
					"Save path and overwrite require an explicit save policy",
				);
			if (
				action.overwrite !== undefined &&
				typeof action.overwrite !== "boolean"
			)
				throw new Error("Overwrite authorization must be a boolean");
			documentAction = {
				lifecycleInstanceId: string(action, "lifecycleInstanceId"),
				kind: action.kind as "rhino" | "grasshopper",
				action: action.action as "new" | "open",
				modifiedPolicy: modifiedPolicy as NextDocumentAction["modifiedPolicy"],
				...(action.path === undefined ? {} : { path: string(action, "path") }),
				...(action.savePath === undefined
					? {}
					: { savePath: string(action, "savePath") }),
				...(action.overwrite === undefined
					? {}
					: { overwrite: action.overwrite }),
			};
		}
		let launch: Extract<SharedBrowserCommand, { type: "submit" }>["launch"];
		if (v.launch !== undefined) {
			const value = object(v.launch);
			if (typeof value.independentProcess !== "boolean")
				throw new Error("Invalid process grant");
			launch = {
				installationId: string(value, "installationId"),
				independentProcess: value.independentProcess,
			};
		}
		if (documentAction && launch)
			throw new Error("Submit one bounded startup action at a time");
		if (launch && bindings.length)
			throw new Error(
				"Launch submissions require a coordinator without selected document bindings",
			);
		return {
			type,
			requestId,
			conversationId,
			sessionId,
			kind: v.kind,
			text,
			bindings,
			attachments,
			...(documentAction ? { documentAction } : {}),
			...(launch ? { launch } : {}),
		};
	}
	throw new Error(`Unknown shared command: ${type}`);
}
