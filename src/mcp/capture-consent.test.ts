import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { afterEach, test } from "vitest";
import {
	createRequestStateCodec,
	type ServerContext,
} from "@modelcontextprotocol/server";
import { VISUAL_CAPTURE_ENV_VAR } from "../services/rhino-visual-consent.js";
import { requireCaptureConsent } from "./capture-consent.js";

type State = { purpose: "rhino_capture"; argsHash: string };

function context(options: {
	state?: State;
	responses?: Record<string, unknown>;
} = {}): ServerContext {
	return {
		mcpReq: {
			id: "capture-1",
			method: "tools/call",
			inputResponses: options.responses,
			requestState: () => options.state,
			signal: new AbortController().signal,
			send: async () => ({}),
			notify: async () => {},
			log: async () => {},
			elicitInput: async () => ({ action: "cancel" }),
			requestSampling: async () => ({ model: "test", role: "assistant", content: { type: "text", text: "" } }),
		},
	} as unknown as ServerContext;
}

function codec() {
	return createRequestStateCodec<State>({
		key: randomBytes(32),
		bind: (ctx) => ctx.mcpReq.method,
	});
}

afterEach(() => {
	delete process.env[VISUAL_CAPTURE_ENV_VAR];
});

test("capture consent returns input_required before any capture", async () => {
	const result = await requireCaptureConsent({ view: "active" }, context(), codec());
	assert.ok("result" in result);
	assert.equal((result as any).result.resultType, "input_required");
	assert.ok((result as any).result.inputRequests.captureConsent);
	assert.equal(typeof (result as any).result.requestState, "string");
});

test("a signed accepted retry authorizes only matching capture arguments", async () => {
	const stateCodec = codec();
	const firstContext = context();
	const first = await requireCaptureConsent({ view: "active" }, firstContext, stateCodec);
	const wireState = (first as any).result.requestState as string;
	const verified = await stateCodec.verify(wireState, firstContext);
	const accepted = context({
		state: verified,
		responses: {
			captureConsent: { action: "accept", content: { approved: true } },
		},
	});

	assert.deepEqual(
		await requireCaptureConsent({ view: "active" }, accepted, stateCodec),
		{ allowed: true },
	);
	const changed = await requireCaptureConsent({ view: "top" }, accepted, stateCodec);
	assert.ok("result" in changed);
	assert.equal((changed as any).result.isError, true);
});

test("environment allow bypasses MRTR and deny returns a tool error", async () => {
	process.env[VISUAL_CAPTURE_ENV_VAR] = "allow";
	assert.deepEqual(
		await requireCaptureConsent({}, context(), codec()),
		{ allowed: true },
	);

	process.env[VISUAL_CAPTURE_ENV_VAR] = "deny";
	const denied = await requireCaptureConsent({}, context(), codec());
	assert.ok("result" in denied);
	assert.equal((denied as any).result.isError, true);
});
