import { expect, it, vi } from "vitest";
import { HostMessageBus } from "./message-bus.js";
import { BrowserUiContext } from "./web-ui-context.js";
it("removes a pending Pi auth prompt when the callback or user cancels it", async () => {
	const bus = new HostMessageBus();
	const listener = vi.fn();
	bus.subscribe(listener);
	const ui = new BrowserUiContext(bus);
	const controller = new AbortController();
	const prompt = ui.requestAuthPrompt({
		type: "manual_code",
		message: "Paste code",
		signal: controller.signal,
	});
	const rejected = expect(prompt).rejects.toThrow("aborted");
	const request = listener.mock.calls[0][0];
	controller.abort();
	await rejected;
	expect(listener).toHaveBeenLastCalledWith({ type: "ui_request_cancelled", requestId: request.requestId });
	expect(ui.respond(request.requestId, "late-code")).toBe(false);
});
