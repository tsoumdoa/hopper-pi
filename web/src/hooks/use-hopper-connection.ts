import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ClientMessage, ServerMessage } from "../../../src/host/protocol.js";
import { CONNECTED_DETAIL, createToast, hopperReducer, initialHopperState } from "../state/hopper-reducer";
import type { SendMode } from "../state/hopper-types";
import { MockHopperTransport } from "../mocks/hopper-mock";
import { providerLabel, safeExternalUrl } from "../lib/utils";

export const isMockMode = import.meta.env.MODE === "mock";

const CONNECTED_STATUSES = ["authenticated", "ready", "connected", "idle", "streaming"];

function readToken() {
	const raw = window.location.hash.slice(1);
	let token = "";
	if (raw) {
		const params = new URLSearchParams(raw);
		try {
			token = params.get("token") || (raw.includes("=") ? "" : decodeURIComponent(raw));
		} catch {
			token = "";
		}
		if (token) {
			sessionStorage.setItem("hopper.sessionToken", token);
			history.replaceState(null, "", `${location.pathname}${location.search}`);
		}
	}
	return token || sessionStorage.getItem("hopper.sessionToken") || "";
}

function socketUrl() {
	const url = new URL("/ws", window.location.href);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	return url.toString();
}

export function useHopperConnection() {
	const [state, dispatch] = useReducer(hopperReducer, initialHopperState);
	const socket = useRef<WebSocket | null>(null);
	const mockTransport = useRef<MockHopperTransport | null>(null);
	const reconnectTimer = useRef<number | null>(null);
	const intentionalClose = useRef(false);
	const attempt = useRef(0);
	const authenticated = useRef(false);
	// Mirrors state.providers so message handlers can label providers without re-subscribing.
	const providersRef = useRef(state.providers);
	providersRef.current = state.providers;
	const token = useMemo(() => (isMockMode ? "mock-session" : readToken()), []);
	const [reconnectNonce, setReconnectNonce] = useState(0);

	const toast = useCallback((...args: Parameters<typeof createToast>) => dispatch({ type: "toast", notice: createToast(...args) }), []);

	const markConnected = useCallback(() => {
		authenticated.current = true;
		attempt.current = 0;
		dispatch({ type: "connection", status: "connected", detail: CONNECTED_DETAIL, reconnectAttempt: 0 });
	}, []);

	const handleServerMessage = useCallback((message: ServerMessage) => {
		switch (message.type) {
			case "snapshot":
				authenticated.current = true;
				attempt.current = 0;
				dispatch({ type: "snapshot", snapshot: message.snapshot });
				break;
			case "session_replaced":
				authenticated.current = true;
				dispatch({ type: "snapshot", snapshot: message.session });
				break;
			case "agent_event":
				dispatch({ type: "agent-event", event: message.event as Record<string, unknown> });
				break;
			case "ui_request": {
				const { type: _type, ...request } = message;
				dispatch({ type: "ui-request", request });
				break;
			}
			case "ui_notification":
				toast(message.message, message.level);
				break;
			case "ui_status": {
				const text = typeof message.text === "string" ? message.text : "";
				if (message.key === "title" && text) dispatch({ type: "session-title", title: text });
				if (message.key === "working") dispatch({ type: "working-message", text: text || null });
				break;
			}
			case "ui_widget": {
				const lines = Array.isArray(message.lines) ? message.lines.map(String) : [];
				if (message.key === "hopper-backend") dispatch({ type: "backend-detail", detail: lines.length ? lines.join(" ") : "Hopper/Rhino runtime unavailable" });
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
				dispatch({ type: "auth-notice", notice, url, label: url ? label : undefined });
				toast(notice, "info", url ? { url, label } : {});
				break;
			}
			case "status": {
				const status = message.status;
				const detail = message.message;
				if (CONNECTED_STATUSES.includes(status)) markConnected();
				if (status === "streaming" || typeof message.streaming === "boolean") {
					dispatch({ type: "streaming", streaming: status === "streaming" || message.streaming === true });
				}
				if (["error", "failed"].includes(status)) {
					dispatch({ type: "connection", status: "error", detail: detail ?? "The local Hopper host reported an error" });
				}
				if (message.scope === "auth" || typeof message.provider === "string") {
					const name = providerLabel(typeof message.provider === "string" ? message.provider : undefined, providersRef.current);
					if (["authenticated", "connected", "ready", "logged_in"].includes(status)) {
						dispatch({ type: "auth-complete" });
						toast(`${name} connected.`, "success");
					} else if (["logged_out", "disconnected"].includes(status)) {
						dispatch({ type: "auth-reset" });
						toast(`${name} logged out.`, "info");
					}
				}
				break;
			}
			case "error": {
				const text = message.message;
				const requestType = message.requestType ?? "";
				if (["login", "logout"].includes(requestType)) dispatch({ type: "auth-error", error: text });
				// A rejected prompt never produces agent events, so undo the optimistic "working" state.
				if (requestType === "prompt") dispatch({ type: "streaming", streaming: false });
				toast(text, "error");
				break;
			}
			default:
				console.debug("Unknown Hopper message", message);
		}
	}, [markConnected, toast]);

	const send = useCallback((message: ClientMessage, options: { requireAuth?: boolean } = {}) => {
		const requireAuth = options.requireAuth ?? true;
		if (isMockMode && mockTransport.current) {
			mockTransport.current.send(message);
			return true;
		}
		if (!socket.current || socket.current.readyState !== WebSocket.OPEN) {
			toast("Hopper is not connected.", "error");
			return false;
		}
		if (requireAuth && !authenticated.current) {
			toast("Hopper is still authenticating.", "warning");
			return false;
		}
		socket.current.send(JSON.stringify(message));
		return true;
	}, [toast]);

	const reconnect = useCallback(() => {
		if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
		reconnectTimer.current = null;
		attempt.current = 0;
		if (isMockMode) {
			mockTransport.current?.close();
		} else {
			intentionalClose.current = true;
			socket.current?.close(1000, "Reconnect requested");
			socket.current = null;
		}
		setReconnectNonce((value) => value + 1);
	}, []);

	useEffect(() => {
		if (isMockMode) {
			authenticated.current = true;
			dispatch({ type: "connection", status: "authenticating", detail: "Starting the local mock Hopper session" });
			const transport = new MockHopperTransport(handleServerMessage);
			mockTransport.current = transport;
			transport.connect();
			return () => {
				if (mockTransport.current === transport) mockTransport.current = null;
				transport.close();
			};
		}
		if (!token) {
			dispatch({ type: "connection", status: "error", detail: "This page has no Hopper session token. Run _HopperCode in Rhino to open a fresh link." });
			return;
		}
		intentionalClose.current = false;
		authenticated.current = false;
		dispatch({ type: "connection", status: "connecting", detail: "Opening the local Hopper host", reconnectAttempt: attempt.current });
		const current = new WebSocket(socketUrl());
		socket.current = current;
		current.addEventListener("open", () => {
			dispatch({ type: "connection", status: "authenticating", detail: "Confirming the Rhino session" });
			current.send(JSON.stringify({ type: "authenticate", token }));
		});
		current.addEventListener("message", (event) => {
			let message: ServerMessage;
			try {
				message = JSON.parse(String(event.data)) as ServerMessage;
			} catch {
				toast("Hopper sent an unreadable message.", "error");
				return;
			}
			handleServerMessage(message);
		});
		current.addEventListener("close", (event) => {
			if (socket.current !== current) return;
			socket.current = null;
			authenticated.current = false;
			const reason = event.reason || "The local host closed the connection";
			if (intentionalClose.current) {
				dispatch({ type: "connection", status: "disconnected", detail: reason, reconnectAttempt: attempt.current });
				return;
			}
			const delay = Math.min(1_000 * 2 ** attempt.current, 10_000);
			attempt.current += 1;
			dispatch({ type: "connection", status: "disconnected", detail: `${reason}. Retrying in ${Math.ceil(delay / 1000)}s…`, reconnectAttempt: attempt.current });
			reconnectTimer.current = window.setTimeout(() => {
				reconnectTimer.current = null;
				setReconnectNonce((value) => value + 1);
			}, delay);
		});
		current.addEventListener("error", () => {
			if (socket.current === current) dispatch({ type: "connection", status: "error", detail: "The local Hopper host did not respond" });
		});
		return () => {
			if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
			reconnectTimer.current = null;
			intentionalClose.current = true;
			if (socket.current === current) socket.current = null;
			current.close(1000, "Page updated");
		};
	}, [handleServerMessage, reconnectNonce, toast, token]);

	useEffect(() => {
		const onOnline = () => {
			if (!socket.current || socket.current.readyState !== WebSocket.OPEN) reconnect();
		};
		window.addEventListener("online", onOnline);
		return () => window.removeEventListener("online", onOnline);
	}, [reconnect]);

	const prompt = useCallback((text: string, type: SendMode) => {
		if (!send({ type, text })) return false;
		dispatch({ type: "user-message", text, kind: type });
		return true;
	}, [send]);

	const login = useCallback((provider: string, authType: "api_key" | "oauth", apiKey?: string) => {
		const notice = authType === "oauth" ? "Starting browser sign-in…" : "Checking the API key…";
		if (!send({ type: "login", provider, authType, ...(apiKey ? { apiKey } : {}) })) return false;
		dispatch({ type: "auth-start", provider, notice });
		return true;
	}, [send]);

	const logout = useCallback((provider: string) => {
		if (!send({ type: "logout", provider })) return false;
		dispatch({ type: "auth-start", provider, notice: "Signing out…" });
		return true;
	}, [send]);

	return { state, dispatch, token, send, prompt, login, logout, reconnect, isMockMode };
}
