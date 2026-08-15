// Generates shared protocol contract fixtures under contracts/protocol/v1.
// Both the TypeScript (vitest) and C# (xunit) suites load these fixtures and
// recompute canonical digests to prove cross-language parity.
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { canonicalJsonSha256, createRequestId, mutationPayloadSha256 } from "../src/protocol/wire.ts";

const outDir = "contracts/protocol/v1/";
mkdirSync(outDir, { recursive: true });

function canonical(value) {
	return createHash("sha256").update(canonicalJsonText(value), "utf8").digest("hex");
}

// Local copy so the fixture generator can also record the exact canonical text.
function canonicalJsonText(value, path = "$") {
	if (value === null) return "null";
	if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new TypeError(`Non-finite number at ${path}`);
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((item, index) => canonicalJsonText(item, `${path}/${index}`)).join(",")}]`;
	}
	if (!value || typeof value !== "object") throw new TypeError(`Non-JSON value at ${path}`);
	const keys = Object.keys(value).sort();
	return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJsonText(value[key], `${path}/${key}`)}`).join(",")}}`;
}

const vectors = [
	{ name: "empty-object", value: {} },
	{ name: "key-sorting", value: { zeta: 1, alpha: 2, Mid: 3, beta: { deep: true, alpha: false } } },
	{
		name: "array-order-preserved",
		value: { items: [3, 1, 2], nested: [{ b: 1, a: 2 }, [true, false, null]] },
	},
	{ name: "numbers", value: { int: 42, negative: -7, half: 0.5, mixed: -2.25, zero: 0, big: 9007199254740991 } },
	{
		name: "strings",
		value: {
			plain: "grasshopper",
			unicode: "héllo wörld 🦗",
			escaped: "line\nbreak\ttab\"quote\\slash",
			empty: "",
		},
	},
	{
		name: "mutation-body",
		value: {
			expectedBackendId: "be_01J9FIXTURE000000000000000",
			expectedGrasshopperDocumentId: "ghd_01J9FIXTURE00000000000GH",
			expectedRhinoDocumentId: null,
			expectedCanvasDigest: null,
			transactionName: "fixture transaction",
			scope: "grasshopper",
			actions: [
				{ kind: "command", command: { action: "addComponent", params: { typeGuid: "df2a4a64-6k", position: { x: 120.5, y: 80 } } } },
				{ kind: "applyGraph", input: { type: "applyGraph", components: [], widgets: [], scripts: [], wires: [], groups: [] } },
			],
		},
	},
];

const requestId = createRequestId(new Date("2026-08-15T00:00:00.000Z"), new Uint8Array(10).fill(0xab));
const executeActionsBody = {
	expectedBackendId: "be_01J9FIXTUREBACKEND000000000",
	expectedGrasshopperDocumentId: "ghd_01J9FIXTURECANVAS000000000",
	expectedRhinoDocumentId: null,
	expectedCanvasDigest: null,
	transactionName: "fixture: apply two actions",
	scope: "grasshopper",
	actions: [
		{ kind: "command", command: { action: "moveComponent", params: { targetId: "c9f1", position: { x: 200, y: 150.5 } } } },
	],
};

const canonicalJsonVectors = {
	schemaVersion: 1,
	vectors: vectors.map((entry) => ({
		name: entry.name,
		value: entry.value,
		canonical: canonicalJsonText(entry.value),
		sha256: canonical(entry.value),
	})),
};

const executeActionsRequest = {
	schemaVersion: 1,
	request: {
		protocolVersion: 1,
		type: "executeActions",
		requestId,
		issuedAt: "2026-08-15T00:00:00.000Z",
		body: executeActionsBody,
	},
	payloadSha256: mutationPayloadSha256(executeActionsBody),
	canonicalBodySha256: canonical(executeActionsBody),
};

const requestIds = {
	schemaVersion: 1,
	cases: [
		{ name: "epoch", epochMs: 0, randomHex: "00000000000000000000" },
		{ name: "2026-08-15", epochMs: Date.parse("2026-08-15T12:34:56.789Z"), randomHex: "deadbeefcafebabe0123" },
		{ name: "max-timestamp", epochMs: 253402300799000, randomHex: "ffffffffffffffffffff" },
	].map((entry) => {
		const random = new Uint8Array(10);
		for (let index = 0; index < 10; index++) {
			random[index] = Number.parseInt(entry.randomHex.slice(index * 2, index * 2 + 2), 16);
		}
		return { ...entry, expected: createRequestId(entry.epochMs, random) };
	}),
};

writeFileSync(`${outDir}canonical-json-vectors.json`, JSON.stringify(canonicalJsonVectors, null, "\t") + "\n");
writeFileSync(`${outDir}execute-actions-request.json`, JSON.stringify(executeActionsRequest, null, "\t") + "\n");
writeFileSync(`${outDir}request-ids.json`, JSON.stringify(requestIds, null, "\t") + "\n");
console.log(`fixtures written to ${outDir}`);
