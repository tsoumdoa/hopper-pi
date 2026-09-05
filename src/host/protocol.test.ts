import { describe, expect, it } from "vitest";
import { parseClientMessage } from "./protocol.js";

describe("browser protocol", () => {
	it("parses supported messages", () => {
		expect(parseClientMessage('{"type":"prompt","text":"make a loft"}'))
			.toEqual({ type: "prompt", text: "make a loft" });
		expect(parseClientMessage('{"type":"login","provider":"anthropic","authType":"api_key"}'))
			.toEqual({ type: "login", provider: "anthropic", authType: "api_key" });
		expect(parseClientMessage('{"type":"set_model","provider":"anthropic","modelId":"opus"}'))
			.toEqual({ type: "set_model", provider: "anthropic", id: "opus" });
		expect(parseClientMessage('{"type":"ui_response","requestId":"r1","result":false,"cancelled":false}'))
			.toEqual({ type: "ui_response", requestId: "r1", value: false });
	});

	it("rejects malformed and unknown messages", () => {
		expect(() => parseClientMessage("no")) .toThrow("valid JSON");
		expect(() => parseClientMessage('{"type":"prompt","text":""}')).toThrow("non-empty string");
		expect(() => parseClientMessage('{"type":"wat"}')).toThrow("Unknown message type");
	});
});
