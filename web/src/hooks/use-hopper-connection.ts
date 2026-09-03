import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { hopperReducer, initialHopperState } from "../state/hopper-reducer";
import type { UiRequest } from "../state/hopper-types";
import { MockHopperTransport } from "../mocks/hopper-mock";

type OutboundMessage = Record<string, unknown>;
export const isMockMode = import.meta.env.MODE === "mock";

function readToken() {
	const raw = window.location.hash.slice(1);
	let token = "";
	if (raw) {
		const params = new URLSearchParams(raw);
		try { token = params.get("token") || (raw.includes("=") ? "" : decodeURIComponent(raw)); } catch { token = ""; }
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

function safeExternalUrl(value: unknown) {
	if (typeof value !== "string") return undefined;
	try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
}

export function useHopperConnection() {
	const [state, dispatch] = useReducer(hopperReducer, initialHopperState);
	const socket = useRef<WebSocket | null>(null);
	const mockTransport = useRef<MockHopperTransport | null>(null);
	const reconnectTimer = useRef<number | null>(null);
	const intentionalClose = useRef(false);
	const attempt = useRef(0);
	const token = useMemo(() => isMockMode ? "mock-session" : readToken(), []);
	const [reconnectNonce, setReconnectNonce] = useState(0);

	const handleServerMessage = useCallback((message: Record<string, unknown>) => {
		switch (message.type) {
			case "snapshot": dispatch({ type: "snapshot", snapshot: (message.snapshot ?? message.data ?? message) as Record<string, unknown> }); break;
			case "session_replaced": dispatch({ type: "snapshot", snapshot: (message.session ?? message) as Record<string, unknown> }); break;
			case "agent_event": dispatch({ type: "agent-event", event: (message.event ?? message.data ?? message) as Record<string, unknown> }); break;
			case "ui_request": dispatch({ type: "ui-request", request: (message.request ?? message) as UiRequest }); break;
			case "ui_notification": dispatch({ type: "toast", notice: { id: crypto.randomUUID(), message: String(message.message ?? "Hopper notification"), level: (message.level as "info" | "warning" | "error") ?? "info" } }); break;
			case "ui_widget": {
				if (message.key === "hopper-backend") dispatch({ type: "backend-detail", detail: Array.isArray(message.lines) ? message.lines.join(" ") : "Hopper/Rhino runtime unavailable" });
				break;
			}
			case "ui_status": if (message.key === "title" && message.text) dispatch({ type: "session-title", title: String(message.text) }); break;
			case "auth_event": {
				const auth = (message.event ?? message.data ?? {}) as Record<string, unknown>;
				const notice = auth.type === "device_code" ? `Enter code ${auth.userCode} to continue sign-in.` : String(auth.instructions ?? auth.message ?? "Continue sign-in in your browser.");
				dispatch({ type: "toast", notice: { id: crypto.randomUUID(), message: notice, level: "info", url: safeExternalUrl(auth.url ?? auth.verificationUri), label: "Open sign-in" } });
				break;
			}
			case "status": if (["authenticated", "ready", "connected", "idle", "streaming"].includes(String(message.status))) dispatch({ type: "connection", status: "connected", detail: "Private Hopper host on this computer" }); break;
			case "error": dispatch({ type: "toast", notice: { id: crypto.randomUUID(), message: String(message.message ?? "Hopper encountered an error."), level: "error" } }); break;
		}
	}, []);

	const send = useCallback((message: OutboundMessage, options: { requireAuth?: boolean } = {}) => {
		const requireAuth = options.requireAuth ?? true;
		if (isMockMode && mockTransport.current) {
			mockTransport.current.send(message);
			return true;
		}
		if (!socket.current || socket.current.readyState !== WebSocket.OPEN) {
			dispatch({ type: "toast", notice: { id: crypto.randomUUID(), message: "Hopper is not connected.", level: "error" } });
			return false;
		}
		if (requireAuth && state.connection.status !== "connected") {
			dispatch({ type: "toast", notice: { id: crypto.randomUUID(), message: "Hopper is still authenticating.", level: "warning" } });
			return false;
		}
		socket.current.send(JSON.stringify(message));
		return true;
	}, [state.connection.status]);

	const reconnect = useCallback(() => {
		if (isMockMode) {
			mockTransport.current?.close();
			setReconnectNonce((value) => value + 1);
			return;
		}
		intentionalClose.current = true;
		socket.current?.close(1000, "Reconnect requested");
		attempt.current = 0;
		setReconnectNonce((value) => value + 1);
	}, []);

	useEffect(() => {
		if (isMockMode) {
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
			dispatch({ type: "connection", status: "error", detail: "This page has no Hopper session token. Reopen it from Rhino." });
			return;
		}
		intentionalClose.current = false;
		dispatch({ type: "connection", status: "connecting", detail: "Opening the local Hopper host", reconnectAttempt: attempt.current });
		const current = new WebSocket(socketUrl());
		socket.current = current;
		current.addEventListener("open", () => {
			dispatch({ type: "connection", status: "authenticating", detail: "Confirming the Rhino session" });
			current.send(JSON.stringify({ type: "authenticate", token }));
		});
		current.addEventListener("message", (event) => {
			let message: Record<string, unknown>;
			try { message = JSON.parse(String(event.data)) as Record<string, unknown>; } catch {
				dispatch({ type: "toast", notice: { id: crypto.randomUUID(), message: "Hopper sent an unreadable message.", level: "error" } });
				return;
			}
			handleServerMessage(message);
		});
		current.addEventListener("close", (event) => {
			if (socket.current !== current) return;
			socket.current = null;
			dispatch({ type: "connection", status: "disconnected", detail: event.reason || "The local host closed the connection", reconnectAttempt: attempt.current });
			if (!intentionalClose.current) {
				const delay = Math.min(1_000 * 2 ** attempt.current, 10_000);
				attempt.current += 1;
				reconnectTimer.current = window.setTimeout(() => setReconnectNonce((value) => value + 1), delay);
			}
		});
		current.addEventListener("error", () => dispatch({ type: "connection", status: "error", detail: "The local Hopper host did not respond" }));
		return () => {
			if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
			intentionalClose.current = true;
			current.close(1000, "Page updated");
		};
	}, [handleServerMessage, reconnectNonce, token]);

	useEffect(() => () => { intentionalClose.current = true; socket.current?.close(1000, "Page closed"); mockTransport.current?.close(); }, []);

	const prompt = useCallback((text: string, type: "prompt" | "steer" | "follow_up") => {
		if (!send({ type, text })) return false;
		if (type === "prompt") dispatch({ type: "user-message", text });
		return true;
	}, [send]);

	return { state, dispatch, token, send, prompt, reconnect, isMockMode };
}
