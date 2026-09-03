import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerMessage } from "../../../src/host/protocol.js";
import { MockHopperTransport } from "./hopper-mock";

describe("MockHopperTransport", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal("window", { setTimeout, clearTimeout });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it("completes provider login with the same status sequence as the host", () => {
		const messages: ServerMessage[] = [];
		const transport = new MockHopperTransport((message) => messages.push(message));

		transport.send({ type: "login", provider: "anthropic", authType: "api_key", apiKey: "mock-key" });
		vi.advanceTimersByTime(250);

		expect(messages).toContainEqual({ type: "status", status: "authenticated", scope: "auth", provider: "anthropic" });
		const snapshot = [...messages].reverse().find((message): message is Extract<ServerMessage, { type: "snapshot" }> => message.type === "snapshot");
		expect(snapshot?.snapshot.providers).toContainEqual({ id: "anthropic", name: "Anthropic", authenticated: true });
	});

	it("cancels pending stream events when a run is aborted", () => {
		const messages: ServerMessage[] = [];
		const transport = new MockHopperTransport((message) => messages.push(message));

		transport.send({ type: "prompt", text: "Inspect the canvas" });
		transport.send({ type: "abort" });
		vi.runAllTimers();

		expect(messages.map((message) => message.type)).toEqual(["agent_event", "agent_event"]);
		expect(messages[1]).toMatchObject({ type: "agent_event", event: { type: "agent_end" } });
	});
});
