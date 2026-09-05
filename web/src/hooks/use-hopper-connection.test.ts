// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerMessage } from "../../../src/host/protocol.js";
import { useHopperConnection } from "./use-hopper-connection";

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

let root: Root;
let connection: ReturnType<typeof useHopperConnection>;
function Harness() {
	connection = useHopperConnection();
	return null;
}

beforeEach(async () => {
	vi.useFakeTimers();
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("WebSocket", TestSocket);
	TestSocket.instances = [];
	window.location.hash = "test-token";
	root = createRoot(document.createElement("div"));
	await act(async () => root.render(createElement(Harness)));
});

afterEach(async () => {
	await act(async () => root.unmount());
	vi.unstubAllGlobals();
	vi.useRealTimers();
	sessionStorage.clear();
});

describe("Hopper connection recovery", () => {
	it.each([4001, 4003])("waits for an explicit reconnect after close code %s", async (code) => {
		await act(async () => TestSocket.instances[0].close(code));
		await act(async () => {
			window.dispatchEvent(new Event("online"));
			await vi.advanceTimersByTimeAsync(30_000);
		});
		expect(TestSocket.instances).toHaveLength(1);
		expect(connection.state.connection.status).toBe("disconnected");
		expect(connection.state.connection.detail).not.toContain("Retrying");
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
		expect(connection.state.connection.status).toBe("connecting");
		expect(connection.state.session.isStreaming).toBe(false);
	});

	it("keeps the running response active when another prompt is rejected", async () => {
		const socket = TestSocket.instances[0];
		await act(async () => {
			socket.open();
			socket.message({ type: "status", status: "streaming" });
			socket.message({ type: "error", requestType: "prompt", message: "Already streaming" });
		});
		expect(connection.state.session.isStreaming).toBe(true);
		expect(connection.state.notifications.at(-1)?.message).toBe("Already streaming");
	});
});
