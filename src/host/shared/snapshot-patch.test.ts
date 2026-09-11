import { expect, it } from "vitest";
import { applySnapshotPatch, snapshotPatch } from "./snapshot-patch.js";

it("updates, removes and orders rows without resending unchanged images or losing record kinds", () => {
	const image = { id: 1, kind: "progress", payload: "image".repeat(10000) };
	const before = { eventCursor: 1, events: [image, { id: 2, payload: "old" }],
		tasks: [{ id: "task", state: "running" }], records: [{ kind: "scope", id: "a" }, { kind: "grant", id: "a" }] };
	const after = { ...before, eventCursor: 3, events: [{ id: 3, payload: "new" }, image],
		tasks: [{ id: "task", state: "completed" }], records: [{ kind: "grant", id: "a" }] };
	const patch = snapshotPatch(before, after);
	const applied = applySnapshotPatch(before, patch);
	expect(applied).toEqual(after);
	expect(applied.events[1]).toBe(image);
	expect(JSON.stringify(patch)).not.toContain(image.payload);
	expect(() => applySnapshotPatch({ ...before, eventCursor: 0 }, patch)).toThrow(/sequence/);
});
