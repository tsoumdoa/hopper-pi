import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TaskJournal, type Submission } from "./journal.js";

const cleanup: (() => void)[] = [];
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn(); });
function fixture() {
	const dir = mkdtempSync(join(tmpdir(), "hopper-journal-"));
	cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, "journal.sqlite");
	let journal = new TaskJournal(path);
	cleanup.push(() => journal.close());
	journal.registerSession("conversation", "session");
	return { get journal() { return journal; }, reopen() { journal.close(); journal = new TaskJournal(path); return journal; } };
}
function submission(requestId = "request"): Submission {
	return { requestId, conversationId: "conversation", sessionId: "session", kind: "prompt", text: "Build", bindings: [], attachments: [] };
}

describe("shared task journal foundation", () => {
	it("commits one acceptance and retains identity and receipt after reopening", () => {
		const f = fixture();
		const identity = f.journal.identity;
		const receipt = f.journal.accept(submission());
		expect(f.reopen().identity).toBe(identity);
		expect(f.journal.accept(submission())).toEqual(receipt);
		expect(() => f.journal.accept({ ...submission(), text: "Different" })).toThrow(/conflict/);
		expect(f.journal.snapshot().tasks).toHaveLength(1);
		expect(f.journal.snapshot().events).toHaveLength(1);
	});
	it("rolls back acceptance when the session is not in the conversation", () => {
		const { journal } = fixture();
		expect(() => journal.accept({ ...submission(), conversationId: "other" })).toThrow();
		expect(journal.snapshot().tasks).toHaveLength(0);
		expect(journal.accept(submission()).taskId).toBeTruthy();
		expect(() => journal.registerSession("other", "session")).toThrow(/another conversation/);
	});
	it("does not enable an answer before cleanup and creates only one fresh turn", () => {
		const f = fixture(), j = f.journal;
		const { taskId, turnId } = j.accept(submission());
		j.start(taskId, turnId);
		const question = j.ask(taskId, turnId, "call", { text: "Which size?" });
		expect(() => j.answer("answer", question, "Large")).toThrow(/not answerable/);
		expect(() => j.steer("steer", taskId, "session", turnId, "Small")).toThrow();
		j.confirmSuspension(taskId, turnId);
		const next = j.accept(submission("next"));
		expect(() => j.start(next.taskId, next.turnId)).toThrow(/active/);
		const answer = j.answer("answer", question, "Large");
		expect(answer.turnId).not.toBe(turnId);
		expect(() => j.settle(taskId, turnId, "cancelled")).toThrow(/current/);
		expect(f.reopen().answer("answer", question, "Large")).toEqual(answer);
		expect(() => f.journal.answer("duplicate", question, "Large")).toThrow(/not answerable/);
		f.journal.recover();
		expect(f.journal.snapshot().turns.map(t => t.state)).toEqual(["suspended", "queued", "queued"]);
		f.journal.start(taskId, answer.turnId);
		f.reopen().recover();
		expect(f.journal.snapshot().tasks[0].state).toBe("uncertain");
	});
	it("cancellation wins against a late answer", () => {
		const { journal: j } = fixture();
		const { taskId, turnId } = j.accept(submission());
		j.start(taskId, turnId);
		const question = j.ask(taskId, turnId, "call", {});
		j.confirmSuspension(taskId, turnId);
		j.settle(taskId, turnId, "cancelled");
		expect(() => j.answer("late", question, "yes")).toThrow(/not answerable/);
	});
	it("preserves unknown steering delivery and never replays possibly started turns", () => {
		const f = fixture(), j = f.journal;
		const { taskId, turnId } = j.accept(submission());
		j.start(taskId, turnId);
		const delivered = j.steer("s1", taskId, "session", turnId, "One");
		j.steer("s2", taskId, "session", turnId, "Two");
		j.markInput(delivered.inputId, "delivering");
		f.reopen().recover();
		expect(f.journal.snapshot().inputs.map(i => i.state)).toEqual(["unknown", "not_applied"]);
		expect(f.journal.steer("s1", taskId, "session", turnId, "One")).toEqual(delivered);
		expect(() => f.journal.start(taskId, turnId)).toThrow();
		f.journal.recover();
		expect(f.journal.snapshot().events.filter(e => e.kind === "recovery_required")).toHaveLength(1);
	});
	it("serializes conversation execution and rejects stale turn steering", () => {
		const { journal: j } = fixture();
		const first = j.accept(submission()), second = j.accept(submission("next"));
		expect(() => j.start(second.taskId, second.turnId)).toThrow(/active/);
		j.start(first.taskId, first.turnId);
		expect(() => j.start(second.taskId, second.turnId)).toThrow(/active/);
		expect(() => j.steer("wrong", first.taskId, "other", first.turnId, "x")).toThrow(/session/);
		j.settle(first.taskId, first.turnId, "completed");
		j.start(second.taskId, second.turnId);
		expect(() => j.steer("stale", first.taskId, "session", first.turnId, "x")).toThrow();
	});
	it("does not let a previously suspended turn settle a newer pending question", () => {
		const { journal: j } = fixture();
		const first = j.accept(submission());
		j.start(first.taskId, first.turnId);
		const q = j.ask(first.taskId, first.turnId, "first", {});
		j.confirmSuspension(first.taskId, first.turnId);
		const second = j.answer("answer", q, "yes");
		j.start(second.taskId, second.turnId);
		j.ask(second.taskId, second.turnId, "second", {});
		j.confirmSuspension(second.taskId, second.turnId);
		expect(() => j.settle(first.taskId, first.turnId, "cancelled")).toThrow(/current/);
		expect(j.snapshot().tasks[0].state).toBe("awaiting_user");
		j.settle(second.taskId, second.turnId, "cancelled");
	});
	it("delivers steering in acceptance order", () => {
		const { journal: j } = fixture();
		const { taskId, turnId } = j.accept(submission());
		j.start(taskId, turnId);
		const a = j.steer("a", taskId, "session", turnId, "first");
		const b = j.steer("b", taskId, "session", turnId, "second");
		expect(() => j.markInput(b.inputId, "delivering")).toThrow(/Earlier/);
		j.markInput(a.inputId, "delivering");
		expect(() => j.markInput(b.inputId, "delivering")).toThrow(/Earlier/);
		j.markInput(a.inputId, "applied");
		j.markInput(b.inputId, "delivering");
		j.markInput(b.inputId, "applied");
		expect(j.snapshot().inputs.map(i => i.state)).toEqual(["applied", "applied"]);
	});

	it("rejects non-JSON payloads instead of deduplicating lossy encodings", () => {
		const { journal: j } = fixture();
		expect(() => j.accept({ ...submission(), attachments: [undefined] })).toThrow(/JSON/);
		expect(() => j.accept({ ...submission(), attachments: [NaN] })).toThrow(/JSON/);
		expect(() => j.accept({ ...submission(), attachments: new Array(1) })).toThrow(/JSON/);
		expect(() => j.accept({ ...submission(), attachments: new Array(2) })).toThrow(/JSON/);
		expect(j.snapshot().tasks).toHaveLength(0);
	});
});
