import { useEffect, useRef, useState } from "react";
import type { SharedBrowserCommand } from "../../../src/host/shared/browser-protocol.js";
import { parseSharedServerMessage, validateSharedSnapshot, type CommandAccepted, type SharedServerMessage } from "../../../src/protocol/browser-messages.js";
import { applySnapshotPatch } from "../../../src/protocol/snapshot-patch.js";
import type { HopperStore } from "../state/hopper-types";
import { CONNECTED_DETAIL } from "../state/initial-state";
import { handleServerMessage } from "../state/server-messages";
import { readyTargets, type SharedSnapshot } from "../state/shared-snapshot";

const INITIAL_RETRY_DELAY_MS = 1500;
const MAX_RETRY_DELAY_MS = 5 * 60_000;
type DurableCommand = Exclude<Extract<SharedBrowserCommand, { requestId: string }>, { type: "auth_response" }>;
type ConnectionOptions = {
	store: HopperStore;
	toast: (message: string, level?: "error" | "warning" | "info") => void;
	getHistoryRequest: () => Extract<SharedBrowserCommand, { type: "snapshot" }>;
	onSnapshot: (snapshot: SharedSnapshot, context: { wasReady: boolean; sessionChanged: boolean; enqueue: (command: DurableCommand) => void }) => boolean;
	onAccepted: (command: SharedBrowserCommand | undefined, message: CommandAccepted) => void;
};

/** The browser credential arrives in the URL hash once; afterwards it lives in session storage. */
function readCredential(): string {
	const hash = location.hash.slice(1);
	const raw = new URLSearchParams(hash).get("token") || (hash.includes("=") ? "" : hash);
	if (raw) {
		sessionStorage.setItem("hopper.token", raw);
		history.replaceState(null, "", location.pathname + location.search);
	}
	return raw || sessionStorage.getItem("hopper.token") || "";
}


/** Owns socket authentication, retry deadlines and replay of unacknowledged commands. */
export function useSharedConnection(options: ConnectionOptions) {
	const { store, toast } = options;
	const callbacks = useRef(options);
	callbacks.current = options;
	const [nonce, setNonce] = useState(0);
	const socket = useRef<WebSocket>(undefined);
	const credential = useRef<string>(undefined);
	const ready = useRef(false);
	const retryDelay = useRef(INITIAL_RETRY_DELAY_MS);
	const retryConnection = useRef<() => void>(() => {});
	const conversationSession = useRef<string | undefined>(undefined);
	const pending = useRef(new Map<string, DurableCommand>());
	const [, refreshPending] = useState(0);
	const blocked = useRef(false);
	const enqueue = (command: DurableCommand) => {
		pending.current.set(command.requestId, command);
		refreshPending(value => value + 1);
	};
	useEffect(() => {
		const actions = store.getState().actions;
		if (credential.current === undefined) credential.current = readCredential();
		if (!credential.current) {
			actions.setConnection("error", "Run _HopperCode in Rhino to open Hopper.");
			return;
		}
		let disposed = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let deadline: ReturnType<typeof setTimeout> | undefined;
		const isCurrent = () => !disposed && socket.current === ws;
		const retry = (starting = false) => {
			if (!isCurrent() || blocked.current) return;
			ready.current = false;
			socket.current = undefined;
			if (deadline) clearTimeout(deadline);
			if (timer) clearTimeout(timer);
			actions.setBackendDetail("Hopper Code instances unknown while offline");
			actions.setConnection(starting ? "connecting" : "disconnected", starting ? "Starting Hopper…" : "Reconnecting to the local Hopper host…");
			ws.close();
			const delay = retryDelay.current;
			retryDelay.current = Math.min(delay * 2, MAX_RETRY_DELAY_MS);
			timer = setTimeout(() => setNonce((n) => n + 1), delay);
		};
		retryConnection.current = retry;
		const armDeadline = () => {
			if (deadline) clearTimeout(deadline);
			deadline = setTimeout(() => retry(), 10_000);
		};
		actions.setConnection("connecting", nonce ? "Reconnecting to the local Hopper host" : "Opening the local Hopper host");
		const url = new URL("/ws-shared", location.href);
		url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
		const ws = new WebSocket(url);
		socket.current = ws;
		ready.current = false;
		ws.onopen = () => {
			if (!isCurrent()) return;
			actions.setConnection("authenticating", "Confirming the Rhino session");
			try { ws.send(JSON.stringify({ type: "authenticate", token: credential.current })); } catch { retry(); }
		};
		let receivedSnapshot: SharedSnapshot | undefined;
		ws.onmessage = (event) => {
			if (!isCurrent()) return;
			let message: SharedServerMessage | undefined;
			try { message = parseSharedServerMessage(String(event.data)); }
			catch { toast("Hopper sent an unreadable message."); return; }
			if (!message || typeof message !== "object") return;
			if (message.type === "shared_patch") {
				try {
					if (!receivedSnapshot) throw new Error("Missing initial history");
					message = { type: "shared_snapshot", snapshot: validateSharedSnapshot(applySnapshotPatch(receivedSnapshot, message.patch)) };
				} catch { retry(); return; }
			}
			if (message.type === "shared_status") {
				if (!receivedSnapshot) { retry(); return; }
				const { runtime, targets, hostEpoch, conversationSession } = message;
				message = { type: "shared_snapshot", snapshot: { ...receivedSnapshot, runtime, targets, hostEpoch, conversationSession } };
			}
			if (message.type === "shared_snapshot") receivedSnapshot = message.snapshot;
			switch (message.type) {
				case "shared_snapshot": {
					if (deadline) clearTimeout(deadline);
					deadline = undefined;
					const next = message.snapshot;
					const sessionId = next.conversationSession?.id;
					const sessionChanged = conversationSession.current !== undefined && sessionId !== undefined && conversationSession.current !== sessionId;
					const wasReady = ready.current;
					if (sessionChanged) pending.current.clear();
					if (!callbacks.current.onSnapshot(next, { wasReady, sessionChanged, enqueue })) {
						armDeadline();
						break;
					}
					conversationSession.current = sessionId ?? conversationSession.current;
					actions.applySnapshot(next.runtime);
					const available = readyTargets(next).length;
					actions.setBackendDetail(`${available} Rhino ${available === 1 ? "instance" : "instances"} connected`);
					actions.setConnection("connected", CONNECTED_DETAIL, 0);
					retryDelay.current = INITIAL_RETRY_DELAY_MS;
					ready.current = true;
					if (!wasReady || sessionChanged) {
						try {
							for (const command of pending.current.values()) ws.send(JSON.stringify(command));
							ws.send(JSON.stringify(callbacks.current.getHistoryRequest()));
						} catch { retry(); }
					}
					break;
				}
				case "command_accepted": {
					const accepted = message.requestId ? pending.current.get(message.requestId) : undefined;
					if (accepted?.type === "create_conversation" && !message.result?.conversationId) {
						toast("Hopper sent an unreadable message.");
						retry();
						return;
					}
					if (message.requestId) pending.current.delete(message.requestId);
					refreshPending((value) => value + 1);
					callbacks.current.onAccepted(accepted, message);
					break;
				}
				case "error": {
					if (message.requestId) pending.current.delete(message.requestId);
					refreshPending((value) => value + 1);
					if (store.getState().auth.busy && ["login", "logout", "add_provider", "refresh_providers"].includes(message.requestType ?? "")) actions.failAuth(message.message);
					toast(message.message);
					break;
				}
				case "auth_event":
					handleServerMessage(store, message);
					break;
				case "status":
				case "ui_request_cancelled":
				case "tool_settings":
				case "ui_request":
				case "ui_notification":
					handleServerMessage(store, message);
					break;
			}
		};
		ws.onclose = (event) => {
			if (!isCurrent()) return;
			if (deadline) clearTimeout(deadline);
			ready.current = false;
			actions.setBackendDetail("Hopper Code instances unknown while offline");
			blocked.current = event.code === 4001 || event.code === 4003;
			if (blocked.current) {
				socket.current = undefined;
				actions.setConnection(event.code === 4003 ? "error" : "disconnected", event.code === 4003
					? `${event.reason || "Authentication failed"}. Run _HopperCode in Rhino to open a fresh link.`
					: `${event.reason || "Disconnected"}. Reconnect to take control in this tab.`);
			} else {
				retry(event.code === 1013);
			}
		};
		ws.onerror = () => retry();
		armDeadline();
		// A half-open socket can survive sleep without receiving a close event.
		const probe = () => {
			if (!isCurrent() || !ready.current || deadline) return;
			armDeadline();
			try { ws.send(JSON.stringify(callbacks.current.getHistoryRequest())); } catch { retry(); }
		};
		const wake = () => {
			if (disposed || blocked.current) return;
			if (socket.current === ws && ws.readyState === WebSocket.OPEN && ready.current) probe();
			else if (!timer && !socket.current) setNonce((n) => n + 1);
		};
		// A restored network can retry immediately; merely changing tabs must not bypass backoff.
		const online = () => {
			if (disposed || blocked.current) return;
			if (!ready.current && !socket.current) setNonce((n) => n + 1);
			else wake();
		};
		const visible = () => { if (document.visibilityState === "visible") wake(); };
		const heartbeat = setInterval(probe, 15_000);
		window.addEventListener("online", online);
		window.addEventListener("pageshow", wake);
		document.addEventListener("visibilitychange", visible);
		return () => {
			disposed = true;
			ready.current = false;
			if (socket.current === ws) socket.current = undefined;
			if (timer) clearTimeout(timer);
			if (deadline) clearTimeout(deadline);
			clearInterval(heartbeat);
			window.removeEventListener("online", online);
			window.removeEventListener("pageshow", wake);
			document.removeEventListener("visibilitychange", visible);
			receivedSnapshot = undefined;
			ws.onmessage = null;
			ws.close();
		};
	}, [nonce, store, toast]);

	const send = (command: SharedBrowserCommand) => {
		if (!ready.current || socket.current?.readyState !== WebSocket.OPEN) {
			if (["login", "add_provider", "refresh_providers"].includes(command.type)) store.getState().actions.failAuth("Hopper is still connecting. Try again in a moment.");
			toast("Hopper is still connecting. Try again in a moment.", "warning");
			return false;
		}
		// Retain only non-secret durable commands for network retries.
		if ("requestId" in command && command.type !== "auth_response") {
			pending.current.set(command.requestId, command);
			refreshPending((value) => value + 1);
		}
		try { socket.current.send(JSON.stringify(command)); }
		catch {
			if (["login", "add_provider", "refresh_providers"].includes(command.type)) store.getState().actions.failAuth("Connection lost. Please try again.");
			retryConnection.current();
			toast("Connection lost. Your draft is retained while Hopper reconnects.", "warning");
			return false;
		}
		return true;
	};
	const reconnect = () => {
		blocked.current = false;
		retryDelay.current = INITIAL_RETRY_DELAY_MS;
		credential.current = readCredential();
		setNonce((n) => n + 1);
	};

	return {
		send,
		reconnect,
		blocked: blocked.current,
		token: credential.current ?? "",
		pending: pending.current as ReadonlyMap<string, DurableCommand>,
		isReady: () => ready.current && socket.current?.readyState === WebSocket.OPEN,
	};
}
