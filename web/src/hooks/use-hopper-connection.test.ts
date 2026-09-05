// @vitest-environment happy-dom
import { createHopperStore, type HopperStore } from "../state/hopper-store";
import { HopperStoreProvider } from "../state/hopper-store-context";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerMessage } from "../../../src/host/protocol.js";
import { useHopperConnection } from "./use-hopper-connection";
import { UiRequestDialog } from "../components/ui-request-dialog";

class TestSocket extends EventTarget {
	static OPEN = 1;
	static instances: TestSocket[] = [];
	readyState = 0;
	send = vi.fn();
	constructor(_url: string) {
		super();
		TestSocket.instances.push(this);
	}
	open() {
		this.readyState = TestSocket.OPEN;
		this.dispatchEvent(new Event("open"));
	}
	message(message: ServerMessage) {
		this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) }));
	}
	close(code = 1000, reason = "Closed") {
		this.readyState = 3;
		this.dispatchEvent(new CloseEvent("close", { code, reason }));
	}
}

let store: HopperStore;
let root: Root;
let container: HTMLDivElement;
let connection: ReturnType<typeof useHopperConnection>;
function Harness() {
	connection = useHopperConnection();
	return createElement(Fragment, null,
		createElement("button", { id: "reconnect", onClick: connection.reconnect }, "Reconnect"),
		createElement(UiRequestDialog, {
			send: connection.send,
		}),
	);
}

beforeEach(async () => {
	vi.useFakeTimers();
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("WebSocket", TestSocket);
	TestSocket.instances = [];
	window.location.hash = "test-token";
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	store = createHopperStore();
	await act(async () => root.render(createElement(HopperStoreProvider, { store, children: createElement(Harness) })));
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	sessionStorage.clear();
});

describe("Hopper connection recovery", () => {
	it.each([
		{ code: 4001, dismiss: "Cancel" },
		{ code: 4001, dismiss: "Escape" },
		{ code: 4003, dismiss: "Cancel" },
	])("allows $dismiss after close code $code and restores unanswered requests on reconnect", async ({ code, dismiss }) => {
		const socket = TestSocket.instances[0];
		const request = { type: "ui_request", requestId: "pending-input", kind: "input", title: "Enter callback URL", description: "Complete sign-in" } as const;
		await act(async () => {
			socket.open();
			socket.message({ type: "status", status: "authenticated" });
			socket.message(request);
		});
		expect(document.querySelector('[role="dialog"]')).not.toBeNull();
		await act(async () => socket.close(code));
		// Failed submission must keep the draft visible; only explicit dismissal closes it.
		await act(async () => { document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
		expect(store.getState().activeUiRequest?.requestId).toBe(request.requestId);
		await act(async () => {
			if (dismiss === "Escape") document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
			else [...document.querySelectorAll("button")].find((button) => button.textContent === "Cancel")!.click();
		});
		expect(store.getState().activeUiRequest).toBeNull();
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		expect(document.body.style.pointerEvents).not.toBe("none");
		expect(container.getAttribute("aria-hidden")).not.toBe("true");
		expect(socket.send).toHaveBeenCalledTimes(1);
		await act(async () => document.querySelector<HTMLButtonElement>("#reconnect")!.click());
		expect(TestSocket.instances).toHaveLength(2);
		const replacement = TestSocket.instances[1];
		await act(async () => {
			replacement.open();
			replacement.message({ type: "snapshot", snapshot: { sessionId: "session-1", messages: [], isStreaming: false, thinkingLevel: "off", availableThinkingLevels: [], models: [], providers: [] } });
			replacement.message(request);
		});
		expect(store.getState().activeUiRequest?.requestId).toBe(request.requestId);
		expect(document.querySelector('[role="dialog"]')).not.toBeNull();
		await act(async () => [...document.querySelectorAll("button")].find((button) => button.textContent === "Cancel")!.click());
		expect(replacement.send).toHaveBeenLastCalledWith(JSON.stringify({ type: "ui_response", requestId: request.requestId, value: null }));
		expect(store.getState().activeUiRequest).toBeNull();
	});

	it.each([4001, 4003])("waits for an explicit reconnect after close code %s", async (code) => {
		await act(async () => TestSocket.instances[0].close(code));
		await act(async () => {
			window.dispatchEvent(new Event("online"));
			await vi.advanceTimersByTimeAsync(30_000);
		});
		expect(TestSocket.instances).toHaveLength(1);
		expect(store.getState().connection.status).toBe("disconnected");
		expect(store.getState().connection.detail).not.toContain("Retrying");
		await act(async () => connection.reconnect());
		expect(TestSocket.instances).toHaveLength(2);
		await act(async () => TestSocket.instances[1].open());
		expect(TestSocket.instances[1].send).toHaveBeenCalledWith(JSON.stringify({ type: "authenticate", token: "test-token" }));
	});

	it("automatically reconnects after a network interruption", async () => {
		await act(async () => TestSocket.instances[0].close(1006));
		await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
		expect(TestSocket.instances).toHaveLength(2);
	});

	it("ignores late events from a socket replaced by a manual reconnect", async () => {
		const old = TestSocket.instances[0];
		await act(async () => connection.reconnect());
		await act(async () => {
			old.open();
			old.message({ type: "status", status: "streaming" });
		});
		expect(old.send).not.toHaveBeenCalled();
		expect(store.getState().connection.status).toBe("connecting");
		expect(store.getState().session.isStreaming).toBe(false);
	});

	it("keeps the running response active when another prompt is rejected", async () => {
		const socket = TestSocket.instances[0];
		await act(async () => {
			socket.open();
			socket.message({ type: "status", status: "streaming" });
			socket.message({ type: "error", requestType: "prompt", message: "Already streaming" });
		});
		expect(store.getState().session.isStreaming).toBe(true);
		expect(store.getState().notifications.at(-1)?.message).toBe("Already streaming");
	});
});
