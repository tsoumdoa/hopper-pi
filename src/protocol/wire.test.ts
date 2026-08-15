import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import {
	attachMutationPayloadSha256,
	canonicalJsonSha256,
	createRequestId,
	createWireRequest,
	redactWireRequestForLog,
} from "./wire.js";

const fixturesDir = new URL("../../contracts/protocol/v1/", import.meta.url);

function loadFixture(name: string): any {
	return JSON.parse(readFileSync(new URL(name, fixturesDir), "utf8"));
}

test("canonical JSON vectors match the shared C# fixtures", () => {
	const fixtures = loadFixture("canonical-json-vectors.json");
	assert.ok(fixtures.vectors.length >= 6);
	for (const vector of fixtures.vectors) {
		assert.equal(
			canonicalJsonSha256(vector.value),
			vector.sha256,
			`vector ${vector.name} digest mismatch`,
		);
	}
});

test("executeActions fixture digest matches the canonical body", () => {
	const fixture = loadFixture("execute-actions-request.json");
	assert.equal(
		canonicalJsonSha256(fixture.request.body),
		fixture.payloadSha256,
	);
	assert.equal(fixture.canonicalBodySha256, fixture.payloadSha256);
	assert.equal(fixture.request.protocolVersion, 1);
	assert.equal(fixture.request.type, "executeActions");
});

test("request ID fixtures are valid ULIDs with decodable timestamps", () => {
	const fixtures = loadFixture("request-ids.json");
	for (const fixtureCase of fixtures.cases) {
		const requestId = fixtureCase.expected;
		assert.match(requestId, /^req_[0-9A-Z]{26}$/);
		assert.equal(
			decodeUlidMilliseconds(requestId),
			fixtureCase.epochMs,
			`case ${fixtureCase.name}`,
		);
	}
});

test("createRequestId produces sortable ULIDs bound to their timestamp", () => {
	const now = Date.parse("2026-08-15T00:00:00.000Z");
	const first = createRequestId(now, new Uint8Array(10).fill(1));
	const second = createRequestId(now + 1, new Uint8Array(10).fill(1));
	assert.match(first, /^req_[0-9A-Z]{26}$/);
	assert.ok(second > first, "request IDs must sort by timestamp");
	assert.equal(decodeUlidMilliseconds(first), now);
	assert.throws(() => createRequestId(-1));
	assert.throws(() => createRequestId(now, new Uint8Array(9)));
});

test("attachMutationPayloadSha256 hashes the body without the envelope", () => {
	const request = attachMutationPayloadSha256(
		createWireRequest("executeActions", {
			expectedBackendId: "be_x",
			expectedGrasshopperDocumentId: "ghd_y",
			expectedRhinoDocumentId: null,
			expectedCanvasDigest: null,
			transactionName: "t",
			scope: "grasshopper",
			actions: [],
		}, { issuedAt: new Date(0) }),
	);
	assert.equal(
		request.payloadSha256,
		canonicalJsonSha256(request.body),
	);
});

test("redactWireRequestForLog removes bodies and keeps metadata only", () => {
	const request = {
		...createWireRequest("executeActions", { secret: "script source" }),
		payloadSha256: "abc123",
	} as const;
	const redacted = redactWireRequestForLog(request);
	const serialized = JSON.stringify(redacted);
	assert.ok(!serialized.includes("script source"));
	assert.ok(!serialized.includes("token"));
	assert.equal((redacted.body as { sha256: string }).sha256, canonicalJsonSha256(request.body));
});

const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function decodeUlidMilliseconds(requestId: `req_${string}`): number {
	const ulid = requestId.slice(4);
	assert.equal(ulid.length, 26);
	let milliseconds = 0;
	for (let index = 0; index < 10; index++) {
		const value = ULID_ALPHABET.indexOf(ulid[index]);
		assert.ok(value >= 0);
		milliseconds = milliseconds * 32 + value;
	}
	return milliseconds;
}
