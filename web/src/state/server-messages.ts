import type { ServerMessage } from "../../../src/host/protocol.js";
import type { HopperStore } from "./hopper-types";
import { CONNECTED_DETAIL } from "./initial-state";
import { providerLabel, safeExternalUrl } from "../lib/utils";

export const CONNECTED_STATUSES = ["authenticated", "ready", "connected", "idle", "streaming"];

export function handleServerMessage(store: HopperStore, message: ServerMessage) {
	const actions = store.getState().actions;
	const { toast } = actions;
	switch (message.type) {
		case "tool_settings":
			window.dispatchEvent(new CustomEvent("hopper-tool-settings", { detail: message.snapshot }));
			break;
		case "snapshot":
			if (store.getState().session.id !== message.snapshot.sessionId && typeof window !== "undefined") window.dispatchEvent(new Event("hopper-tools-session-changed"));
			actions.applySnapshot(message.snapshot);
			break;
		case "session_replaced":
			if (typeof window !== "undefined") window.dispatchEvent(new Event("hopper-tools-session-changed"));
			actions.applySnapshot(message.session);
			break;
		case "agent_event":
			actions.applyAgentEvent(message.event as Record<string, unknown>);
			break;
		case "ui_request_cancelled": {
			store.setState(state => ({
				activeUiRequest: state.activeUiRequest?.requestId === message.requestId ? state.pendingUiRequests[0] ?? null : state.activeUiRequest,
				pendingUiRequests: state.activeUiRequest?.requestId === message.requestId ? state.pendingUiRequests.slice(1) : state.pendingUiRequests.filter(item => item.requestId !== message.requestId),
			}));
			break;
		}
		case "ui_request": {
			const { type: _type, ...request } = message;
			actions.queueUiRequest(request);
			break;
		}
		case "ui_notification":
			toast(message.message, message.level);
			break;
		case "ui_status": {
			const text = typeof message.text === "string" ? message.text : "";
			if (message.key === "title" && text) actions.setSessionTitle(text);
			if (message.key === "working") actions.setWorkingMessage(text || null);
			break;
		}
		case "ui_widget": {
			const lines = Array.isArray(message.lines) ? message.lines.map(String) : [];
			if (message.key === "hopper-backend") actions.setBackendDetail(lines.length ? lines.join(" ") : "Hopper/Rhino runtime unavailable");
			else if (lines.length) toast(lines.join("\n"), "info");
			break;
		}
		case "auth_event": {
			const auth = message.event as Record<string, unknown>;
			let notice: string | undefined;
			let url: string | undefined;
			let label = "Open link";
			if (auth.type === "auth_url") {
				notice = String(auth.instructions ?? auth.message ?? "Continue sign-in in your browser.");
				url = safeExternalUrl(auth.url);
				label = "Open sign-in";
			} else if (auth.type === "device_code") {
				notice = `Enter code ${auth.userCode} to continue sign-in.`;
				url = safeExternalUrl(auth.verificationUri ?? auth.url);
				label = "Open verification page";
			} else if (typeof auth.message === "string" && auth.message) {
				notice = auth.message;
				const link = Array.isArray(auth.links) ? (auth.links[0] as Record<string, unknown> | undefined) : undefined;
				url = safeExternalUrl(link?.url ?? auth.url);
				if (typeof link?.label === "string") label = link.label;
			}
			if (!notice) break;
			actions.setAuthNotice(notice, url, url ? label : undefined);
			toast(notice, "info", url ? { url, label } : {});
			break;
		}
		case "status": {
			const status = message.status;
			const detail = message.message;
			if (CONNECTED_STATUSES.includes(status)) actions.setConnection("connected", CONNECTED_DETAIL, 0);
			if (status === "streaming" || typeof message.streaming === "boolean") {
				actions.setStreaming(status === "streaming" || message.streaming === true);
			}
			if (["error", "failed"].includes(status)) {
				actions.setConnection("error", detail ?? "The local Hopper host reported an error");
			}
			if (message.scope === "auth" || typeof message.provider === "string") {
				const name = providerLabel(typeof message.provider === "string" ? message.provider : undefined, store.getState().providers);
				if (["authenticated", "connected", "ready", "logged_in"].includes(status)) {
					actions.completeAuth();
					if (message.provider) toast(`${name} credentials saved.`, "success");
				} else if (["logged_out", "disconnected"].includes(status)) {
					actions.resetAuth();
					toast(`${name} logged out.`, "info");
				}
			}
			break;
		}
		case "error": {
			const text = message.message;
			const requestType = message.requestType ?? "";
			if (["login", "logout", "add_provider", "refresh_providers"].includes(requestType)) actions.failAuth(text);
			// The host follows rejected messages with its authoritative session snapshot.
			toast(text, "error");
			break;
		}
		default:
			console.debug("Unknown Hopper message", message);
	}
}
