import { describe, expect, it } from "vitest";
import { createHopperStore } from "./hopper-store";
import { handleServerMessage } from "./server-messages";

const snapshot = {
	sessionId: "session-1", messages: [], isStreaming: false, thinkingLevel: "off", availableThinkingLevels: [], models: [],
	providers: [{ id: "custom-provider", name: "Studio model", authenticated: true, authMethods: [] }],
};

describe("server messages", () => {
	it("reads providers from an immediately preceding snapshot without waiting for React", () => {
		const store = createHopperStore();
		handleServerMessage(store, { type: "snapshot", snapshot });
		handleServerMessage(store, { type: "status", status: "authenticated", scope: "auth", provider: "custom-provider" });
		expect(store.getState().auth.completedCount).toBe(1);
		expect(store.getState().notifications.at(-1)?.message).toBe("Studio model connected.");
	});

	it("keeps auth notices and their toast links consistent", () => {
		const store = createHopperStore();
		store.getState().actions.startAuth("custom-provider", "Starting sign-in");
		handleServerMessage(store, { type: "auth_event", event: { type: "device_code", userCode: "ABCD", verificationUri: "https://example.com/verify" } });
		expect(store.getState().auth).toMatchObject({ busy: true, notice: "Enter code ABCD to continue sign-in.", url: "https://example.com/verify", label: "Open verification page" });
		expect(store.getState().notifications.at(-1)).toMatchObject({ message: store.getState().auth.notice, url: store.getState().auth.url, timeout: 30_000 });
		handleServerMessage(store, { type: "error", requestType: "login", message: "Code expired" });
		expect(store.getState().auth).toMatchObject({ busy: false, error: "Code expired", notice: null });
	});

	it("replaces a session while retaining unrelated runtime and notification state", () => {
		const store = createHopperStore();
		store.getState().actions.addUserMessage("Old prompt", "prompt");
		store.getState().actions.setRuntimeStatusError("Runtime unavailable");
		store.getState().actions.toast("A notice");
		handleServerMessage(store, { type: "session_replaced", session: snapshot });
		expect(store.getState().session).toMatchObject({ id: "session-1", messages: [], isStreaming: false });
		expect(store.getState().runtimeStatusError).toBe("Runtime unavailable");
		expect(store.getState().notifications).toHaveLength(1);
		store.getState().actions.addUserMessage("New prompt", "prompt");
		expect(store.getState().session.messages[0]?.text).toBe("New prompt");
	});
});
