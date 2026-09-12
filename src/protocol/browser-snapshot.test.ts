import { expect, it, vi } from "vitest";
import { TaskJournal } from "../host/shared/journal.js";
import { SharedRegistry } from "../host/shared/registry.js";
import { SharedBackend } from "../host/shared/backend.js";
import type { HostRuntime } from "../host/pi-runtime.js";
import type { SharedTaskService } from "../host/shared/task-service.js";
import type { HostSnapshot } from "../host/protocol.js";
import { readHistorySnapshot, type TaskSnapshot } from "./browser-snapshot.js";
import { parseSharedServerMessage, validateSharedSnapshot } from "./browser-messages.js";
import { snapshotPatch, applySnapshotPatch } from "./snapshot-patch.js";

const runtime: HostSnapshot = {
	sessionId: "admin", messages: [], isStreaming: false, thinkingLevel: "off",
	availableThinkingLevels: ["off"], models: [], providers: [],
};
function fixture() {
	const journal = new TaskJournal(":memory:");
	const registry = new SharedRegistry(journal);
	const conversation = journal.createConversation("chat", "Test chat");
	const root = journal.accept({ ...conversation, requestId: "request", kind: "prompt", text: "Inspect", bindings: [], attachments: [] });
	const tasks = { journal, subscribe: () => () => {} } as unknown as SharedTaskService;
	const admin = { snapshot: () => runtime, bus: { subscribe: () => () => {} } } as unknown as HostRuntime;
	const backend = new SharedBackend(tasks, registry, admin, async () => {});
	return { journal, backend, root, close() { backend.dispose(); journal.close(); } };
}
it("maps real journal rows into the browser contract and round-trips serialized payloads", () => {
	const f = fixture();
	try {
		const snapshot = f.backend.snapshot();
		const task: TaskSnapshot = snapshot.tasks[0];
		expect(task.state).toBe("queued");
		expect(task.payload).toBe(f.journal.getTask(f.root.taskId)?.payload);
		expect(snapshot).not.toHaveProperty("operations");
		expect(parseSharedServerMessage(JSON.stringify({ type: "shared_snapshot", snapshot }))).toEqual({ type: "shared_snapshot", snapshot });
		const raw = f.journal.browserSnapshot();
		raw.tasks[0].internal_column = "not for the UI";
		expect(readHistorySnapshot(raw).tasks[0]).not.toHaveProperty("internal_column");
	} finally { f.close(); }
});
it("rejects invalid task states, missing IDs, malformed JSON, and invalid runtime fields", () => {
	const f = fixture();
	try {
		const snapshot = f.backend.snapshot();
		for (const task of [{ ...snapshot.tasks[0], state: "typo" }, { ...snapshot.tasks[0], id: undefined }, { ...snapshot.tasks[0], payload: "{" }]) {
			expect(() => validateSharedSnapshot({ ...snapshot, tasks: [task] })).toThrow();
		}
		expect(() => validateSharedSnapshot({ ...snapshot, runtime: { ...runtime, models: {} } })).toThrow();
	} finally { f.close(); }
});
it("patches real snapshots without resending equal payloads or replacing unchanged rows", () => {
	const f = fixture();
	try {
		const before = f.backend.snapshot();
		f.journal.start(f.root.taskId, f.root.turnId);
		const next = f.backend.snapshot();
		const patch = snapshotPatch(before, next);
		expect(patch.changes.conversations?.upsert).toHaveLength(1);
		expect(patch.changes.sessions).toBeUndefined();
		const applied = validateSharedSnapshot(applySnapshotPatch(before, patch));
		expect(applied).toEqual(next);
		expect(applied.sessions).toBe(before.sessions);
		expect(applied.sessions[0]).toBe(before.sessions[0]);
		expect(snapshotPatch(next, structuredClone(next)).changes).toEqual({});
		expect(() => applySnapshotPatch(before, { ...patch, baseCursor: -1 })).toThrow();
	} finally { f.close(); }
});
it("preserves tool settings and validates acknowledgement envelopes", () => {
	const snapshot = { tools: [{ name: "inspect", description: "Inspect", parameters: { type: "object" }, active: true }], settings: { version: { epoch: "e", revision: 1 }, parents: [] } };
	expect(parseSharedServerMessage(JSON.stringify({ type: "tool_settings", snapshot }))).toEqual({ type: "tool_settings", snapshot });
	expect(() => parseSharedServerMessage('{"type":"command_accepted","requestId":1}')).toThrow();
	expect(() => parseSharedServerMessage('{"type":"command_accepted","result":"bad"}')).toThrow();
	expect(() => parseSharedServerMessage('{"type":"command_accepted","result":{"cleanupPending":"false"}}')).toThrow();
	expect(() => parseSharedServerMessage('{"type":"command_accepted","result":{"conversationId":42}}')).toThrow();
	expect(parseSharedServerMessage('{"type":"command_accepted","result":{"taskId":"task"}}')).toMatchObject({ result: { taskId: "task" } });
	expect(parseSharedServerMessage('{"type":"future_message"}')).toBeUndefined();
});

it("does not parse unchanged row payloads again when validating a patch", () => {
	const f = fixture();
	try {
		const before = f.backend.snapshot();
		validateSharedSnapshot(before);
		f.journal.start(f.root.taskId, f.root.turnId);
		const next = f.backend.snapshot();
		const applied = applySnapshotPatch(before, snapshotPatch(before, next));
		const parse = vi.spyOn(JSON, "parse");
		try {
			validateSharedSnapshot(applied);
			const parsesAfterChange = parse.mock.calls.length;
			expect(parsesAfterChange).toBeGreaterThan(0);
			validateSharedSnapshot({ ...applied, eventCursor: applied.eventCursor + 1 });
			expect(parse.mock.calls.length).toBe(parsesAfterChange);
		} finally { parse.mockRestore(); }
	} finally { f.close(); }
});
