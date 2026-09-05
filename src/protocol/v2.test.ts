import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	CONTROL_OPERATIONS,
	MUTATION_OPERATIONS,
	NODE_LOCAL_RESULT_CLASSES,
	PROTOCOL_ERROR_REASON_CODES,
	PROTOCOL_VERSION,
	QUERY_OPERATIONS,
	REASON_CODES,
	RHINO_RESULT_CLASSES,
	ROUTER_DEALER_FRAMING,
	classifyOperation,
	validateRpcRequest,
	validateRpcResponse,
} from "./v2.js";

type Fixture = { name: string; value: unknown };
type FixtureFile = {
	validRequests: Fixture[];
	invalidRequests: Fixture[];
	validResponses: Fixture[];
	invalidResponses: Fixture[];
};

type Metadata = {
	protocolVersion: number;
	framing: unknown;
	operationClassification: {
		query: string[];
		control: string[];
		mutation: string[];
	};
	rhinoResultClasses: string[];
	nodeLocalResultClasses: string[];
	reasonCodes: string[];
	protocolErrorReasonCodes: string[];
	uncorrelatedRequestPolicy: string;
};

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const contractDirectory = join(moduleDirectory, "../../protocol/v2");
const fixtures = JSON.parse(readFileSync(join(contractDirectory, "fixtures.json"), "utf8")) as FixtureFile;
const metadata = JSON.parse(readFileSync(join(contractDirectory, "metadata.json"), "utf8")) as Metadata;
const schema = JSON.parse(readFileSync(join(contractDirectory, "hopper-rpc.schema.json"), "utf8")) as Record<string, unknown>;

describe("Hopper RPC v2 fixtures", () => {
	for (const fixture of fixtures.validRequests) {
		it(`accepts request: ${fixture.name}`, () => {
			const result = validateRpcRequest(fixture.value);
			expect(result.ok, result.ok ? undefined : result.errors.join("; ")).toBe(true);
		});
	}

	for (const fixture of fixtures.invalidRequests) {
		it(`rejects request: ${fixture.name}`, () => {
			expect(validateRpcRequest(fixture.value).ok).toBe(false);
		});
	}

	for (const fixture of fixtures.validResponses) {
		it(`accepts response: ${fixture.name}`, () => {
			const result = validateRpcResponse(fixture.value);
			expect(result.ok, result.ok ? undefined : result.errors.join("; ")).toBe(true);
		});
	}

	for (const fixture of fixtures.invalidResponses) {
		it(`rejects response: ${fixture.name}`, () => {
			expect(validateRpcResponse(fixture.value).ok).toBe(false);
		});
	}
});

describe("Hopper RPC v2 metadata", () => {
	it("keeps runtime constants in sync with checked-in metadata", () => {
		assert.equal(metadata.protocolVersion, PROTOCOL_VERSION);
		assert.deepEqual(metadata.operationClassification.query, QUERY_OPERATIONS);
		assert.deepEqual(metadata.operationClassification.control, CONTROL_OPERATIONS);
		assert.deepEqual(metadata.operationClassification.mutation, MUTATION_OPERATIONS);
		assert.deepEqual(metadata.rhinoResultClasses, RHINO_RESULT_CLASSES);
		assert.deepEqual(metadata.nodeLocalResultClasses, NODE_LOCAL_RESULT_CLASSES);
		assert.deepEqual(metadata.reasonCodes, REASON_CODES);
		assert.deepEqual(metadata.protocolErrorReasonCodes, PROTOCOL_ERROR_REASON_CODES);
		assert.deepEqual(metadata.framing, ROUTER_DEALER_FRAMING);
		assert.equal(metadata.uncorrelatedRequestPolicy, "drop");
	});

	it("classifies every operation once", () => {
		const all = [...QUERY_OPERATIONS, ...CONTROL_OPERATIONS, ...MUTATION_OPERATIONS];
		assert.equal(new Set(all).size, all.length);
		for (const operation of QUERY_OPERATIONS) assert.equal(classifyOperation(operation), "query");
		for (const operation of CONTROL_OPERATIONS) assert.equal(classifyOperation(operation), "control");
		for (const operation of MUTATION_OPERATIONS) assert.equal(classifyOperation(operation), "mutation");
		assert.equal(classifyOperation("unknownOperation"), null);
	});

	it("duplicates framing and classification metadata in the JSON Schema", () => {
		assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
		assert.deepEqual(schema["x-hopper-router-dealer-framing"], metadata.framing);
		assert.deepEqual(schema["x-hopper-node-local-result-classes"], metadata.nodeLocalResultClasses);
		assert.ok(schema["x-hopper-operation-classification"]);
	});

	it("keeps outcome_unknown local to Node", () => {
		assert.ok(NODE_LOCAL_RESULT_CLASSES.includes("outcome_unknown"));
		assert.ok(!new Set<string>(RHINO_RESULT_CLASSES).has("outcome_unknown"));
	});
});
