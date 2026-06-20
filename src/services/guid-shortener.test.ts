import assert from "node:assert/strict";
import { test } from "vitest";
import {
	toShortTypeGuid,
	toShortInstanceGuid,
	resolveTypeGuid,
	resolveInstanceGuid,
	shortGuidBase62,
} from "./guid-shortener.js";

const VALID_GUID_A = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const VALID_GUID_B = "b2c3d4e5-f6a7-8901-bcde-f12345678901";
const VALID_GUID_C = "c3d4e5f6-a7b8-9012-cdef-123456789012";

test("shortGuidBase62 returns a string of the requested length", () => {
	const short = shortGuidBase62(VALID_GUID_A, 4);
	assert.equal(short.length, 4);
	assert.match(short, /^[0-9A-Za-z]+$/);
});

test("shortGuidBase62 clamps to the hash output length", () => {
	const short4 = shortGuidBase62(VALID_GUID_A, 4);
	const short100 = shortGuidBase62(VALID_GUID_A, 100);
	assert.ok(short100.length >= short4.length, "longer request should not be shorter");
	assert.ok(short100.length <= 50, `expected reasonable length, got ${short100.length}`);
});

test("toShortTypeGuid returns a 4-char short for a new GUID", () => {
	const short = toShortTypeGuid(VALID_GUID_A);
	assert.equal(short.length, 4);
	assert.match(short, /^[0-9A-Za-z]+$/);
});

test("toShortTypeGuid is idempotent for the same GUID", () => {
	const first = toShortTypeGuid(VALID_GUID_B);
	const second = toShortTypeGuid(VALID_GUID_B);
	assert.equal(first, second);
});

test("different GUIDs get different shorts", () => {
	const shortA = toShortTypeGuid(VALID_GUID_A);
	const shortB = toShortTypeGuid(VALID_GUID_B);
	assert.notEqual(shortA, shortB);
});

test("resolveTypeGuid round-trips a short back to the full GUID", () => {
	const short = toShortTypeGuid(VALID_GUID_C);
	const resolved = resolveTypeGuid(short);
	assert.equal(resolved, VALID_GUID_C);
});

test("resolveTypeGuid passes through a full GUID", () => {
	const resolved = resolveTypeGuid(VALID_GUID_A);
	assert.equal(resolved, VALID_GUID_A);
});

test("resolveTypeGuid passes through unknown short unchanged", () => {
	const resolved = resolveTypeGuid("zzzz");
	assert.equal(resolved, "zzzz");
});

test("empty/falsy input returns empty/falsy", () => {
	assert.equal(toShortTypeGuid(""), "");
	assert.equal(resolveTypeGuid(""), "");
});

test("GUID normalization handles braces and case", () => {
	const braced = "{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}";
	const short1 = toShortTypeGuid(VALID_GUID_A);
	const short2 = toShortTypeGuid(braced);
	assert.equal(short1, short2);
});

test("type, instance, and rhino stores resolve independently", () => {
	const typeGuid = "aaaa1111-bbbb-cccc-dddd-eeeeeeee0001";
	const instanceGuid = "aaaa2222-bbbb-cccc-dddd-eeeeeeee0002";
	const typeShort = toShortTypeGuid(typeGuid);
	const instanceShort = toShortInstanceGuid(instanceGuid);
	assert.equal(resolveTypeGuid(typeShort), typeGuid);
	assert.equal(resolveInstanceGuid(instanceShort), instanceGuid);
	assert.equal(resolveInstanceGuid(typeShort), typeShort, "type short should not resolve in instance store");
	assert.equal(resolveTypeGuid(instanceShort), instanceShort, "instance short should not resolve in type store");
});

test("collision expansion: registering many GUIDs yields unique shorts", () => {
	const shorts = new Set<string>();
	const guids: string[] = [];
	for (let i = 0; i < 8000; i++) {
		const hex = i.toString(16).padStart(32, "0");
		guids.push(`${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`);
	}
	for (const g of guids) {
		const short = toShortInstanceGuid(g);
		assert.ok(!shorts.has(short), `collision detected for short "${short}"`);
		shorts.add(short);
	}
	assert.ok(shorts.size === guids.length, "short count should match GUID count");
});

test("resolveInstanceGuid resolves registered instance shorts", () => {
	const guid = "11223344-5566-7788-99aa-bbccddeeff00";
	const short = toShortInstanceGuid(guid);
	const resolved = resolveInstanceGuid(short);
	assert.equal(resolved, guid);
});
