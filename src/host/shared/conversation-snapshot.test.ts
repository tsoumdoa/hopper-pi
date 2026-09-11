import { expect, it } from "vitest";
import { TaskJournal } from "./journal.js";

const fixtureText = "Explicit deterministic native launch, New and geometry transfer fixture. No model API is called.";

it("hides marked fixtures atomically while retaining mixed-conversation user messages and raw evidence", () => {
	const journal = new TaskJournal(":memory:");
	try {
		const mixed = journal.createConversation("mixed", "Native acceptance fixture");
		const empty = journal.createConversation("empty", "Native acceptance fixture");
		const ordinary = journal.createConversation("ordinary", "Native acceptance fixture");
		const submit = (conversation: typeof mixed, requestId: string, text: string, diagnosticFixture?: "shared-host-native-smoke") => journal.accept({
			...conversation, requestId, kind: "prompt", text, bindings: [], attachments: [],
			...(diagnosticFixture ? { diagnosticFixture } : {}),
		});
		const diagnostic = submit(mixed, "probe", "Fixture", "shared-host-native-smoke");
		submit(empty, "other-probe", "Fixture", "shared-host-native-smoke");
		const user = submit(mixed, "user", "hey");
		// Neither a diagnostic-looking title nor identical text is sufficient.
		const sameText = submit(ordinary, "ordinary-uuid", fixtureText);
		const snapshot = journal.snapshot();
		const visible = journal.browserSnapshot({ conversationId: mixed.conversationId });
		const other = journal.browserSnapshot({ conversationId: ordinary.conversationId });
		expect(visible.tasks.map((row) => row.id)).toEqual([user.taskId]);
		expect(other.tasks.map((row) => row.id)).toEqual([sameText.taskId]);
		expect(other.conversations).toEqual(visible.conversations);
		expect(visible.conversations.map((row) => row.id)).toEqual([mixed.conversationId, ordinary.conversationId]);
		expect(visible.conversations[0].title).toBe("hey");
		expect(visible.sessions.some((row) => row.conversation_id === empty.conversationId)).toBe(false);
		expect(visible.events.some((row) => row.task_id === diagnostic.taskId)).toBe(false);
		expect(visible.turns.some((row) => row.task_id === diagnostic.taskId)).toBe(false);
		expect(journal.snapshot().tasks).toHaveLength(4);
		expect(snapshot.conversations[0].title).toBe("Native acceptance fixture");
	} finally { journal.close(); }
});

it("recognizes only exact historical fixture request and text signatures", () => {
	const journal = new TaskJournal(":memory:");
	try {
		const conversation = journal.createConversation("conversation", "Test");
		const submit = (requestId: string, text: string) => journal.accept({
			...conversation, requestId, text, kind: "prompt", bindings: [], attachments: [],
		});
		submit("transfer-fixture-root-1788886874025", fixtureText);
		submit("native-launch-probe-root-1788886874025", "Explicit native launch acceptance fixture. No model driver is started for this test.");
		const user = submit("transfer-fixture-root-1788886874026", "Please create a sphere");
		const similar = submit("transfer-fixture-root-123x", fixtureText);
		const visible = journal.browserSnapshot();
		expect(visible.tasks.map((row) => row.id)).toEqual([user.taskId, similar.taskId]);
		expect(visible.conversations[0].title).toBe("Please create a sphere");
	} finally { journal.close(); }
});

it("filters fixture roots before paging and uses the first real prompt as the mixed chat title", () => {
	const journal = new TaskJournal(":memory:");
	try {
		const conversation = journal.createConversation("mixed", "Fixture");
		const ids: string[] = [];
		for (let index = 0; index < 52; index++) {
			const fixture = index % 2 === 0;
			const { taskId, turnId } = journal.accept({ ...conversation, requestId: `request-${index}`, kind: "prompt",
				text: fixture ? "Diagnostic" : index === 1 ? "\n\tA real chat\t\n" : `Message ${index}`,
				bindings: [], attachments: [], ...(fixture ? { diagnosticFixture: "shared-host-native-smoke" as const } : {}) });
			journal.start(taskId, turnId); journal.settle(taskId, turnId, "completed");
			if (!fixture) ids.push(taskId);
		}
		const latest = journal.browserSnapshot();
		expect(latest.conversations[0].title).toBe("A real chat");
		expect(latest.history.hasOlder).toBe(true);
		expect(latest.history.pageTaskIds).toEqual(ids.slice(-20));
		const older = journal.browserSnapshot({ conversationId: conversation.conversationId, before: Number(latest.history.oldestSequence) });
		expect(older.conversations).toEqual(latest.conversations);
		expect(older.history.hasOlder).toBe(false);
		expect(older.history.pageTaskIds).toEqual(ids.slice(0, 6));
		expect(journal.snapshot().tasks).toHaveLength(52);
	} finally { journal.close(); }
});
