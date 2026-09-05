import { describe, expect, it } from "vitest";
import { HostMessageBus } from "./message-bus.js";
import type { UiRequestMessage } from "./protocol.js";
import { BrowserUiContext } from "./web-ui-context.js";

describe("browser UI context", () => {
	it("round-trips extension selection requests", async () => {
		const bus = new HostMessageBus();
		const messages: UiRequestMessage[] = [];
		bus.subscribe((message) => {
			if (message.type === "ui_request") messages.push(message);
		});
		const ui = new BrowserUiContext(bus);

		const answer = ui.context.select("Choose", ["A", "B"]);
		expect(messages[0]).toMatchObject({ kind: "select", title: "Choose" });
		expect(ui.respond(messages[0].requestId, "B")).toBe(true);
		await expect(answer).resolves.toBe("B");
		expect(ui.respond(messages[0].requestId, "A")).toBe(false);
	});

	it("replays pending dialogs after a browser reconnect", () => {
		const bus = new HostMessageBus();
		const messages: UiRequestMessage[] = [];
		bus.subscribe((message) => {
			if (message.type === "ui_request") messages.push(message);
		});
		const ui = new BrowserUiContext(bus);
		const pending = ui.context.input("Question");
		ui.replayPending();
		expect(messages).toHaveLength(2);
		expect(messages[1].requestId).toBe(messages[0].requestId);
		ui.cancelAll();
		return expect(pending).rejects.toThrow("UI closed");
	});

	it("cancels a pending dialog with the Pi abort signal", async () => {
		const ui = new BrowserUiContext(new HostMessageBus());
		const controller = new AbortController();
		const answer = ui.context.input("Question", undefined, { signal: controller.signal });
		controller.abort();
		await expect(answer).rejects.toThrow("aborted");
	});
});
