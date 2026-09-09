import type { Row, TaskJournal } from "./journal.js";

type Snapshot = ReturnType<TaskJournal["snapshot"]>;

function submission(row: Row): Record<string, unknown> {
	try {
		return JSON.parse(String(row.payload));
	} catch {
		return {};
	}
}

function isFixture(row: Row): boolean {
	const payload = submission(row);
	if (payload.diagnosticFixture === "shared-host-native-smoke") return true;
	// Older acceptance runs predate the explicit marker. Match their exact
	// generated request IDs AND script text, never a conversation title.
	return (
		(typeof payload.requestId === "string" &&
			/^native-launch-probe-root-[0-9]+$/.test(payload.requestId) &&
			payload.text === "Explicit native launch acceptance fixture. No model driver is started for this test.") ||
		(typeof payload.requestId === "string" &&
			/^transfer-fixture-root-[0-9]+$/.test(payload.requestId) &&
			payload.text === "Explicit deterministic native launch, New and geometry transfer fixture. No model API is called.")
	);
}

/** Keep diagnostics in the durable journal/export, outside ordinary chat. */
export function conversationSnapshot(snapshot: Snapshot): Snapshot {
	const hidden = new Set(snapshot.tasks.filter(isFixture).map((row) => row.id));
	if (hidden.size === 0) return snapshot;
	// Child work belongs to the fixture, but later user prompts in its session do not.
	let size: number;
	do {
		size = hidden.size;
		for (const task of snapshot.tasks)
			if (hidden.has(task.parent_task_id) || hidden.has(task.root_task_id))
				hidden.add(task.id);
	} while (hidden.size !== size);
	const affected = new Set(snapshot.tasks.filter((row) => hidden.has(row.id)).map((row) => row.conversation_id));
	const tasks = snapshot.tasks.filter((row) => !hidden.has(row.id));
	const conversations = snapshot.conversations.flatMap((row) => {
		if (!affected.has(row.id)) return [row];
		const firstUserTask = tasks.find((task) => task.conversation_id === row.id && !task.parent_task_id);
		if (!firstUserTask) return [];
		const text = submission(firstUserTask).text;
		return [{ ...row, title: typeof text === "string" && text.trim() ? text.trim().slice(0, 80) : "Conversation" }];
	});
	const visibleConversations = new Set(conversations.map((row) => row.id));
	const belongs = (row: Row) => !hidden.has(row.task_id);
	const operations = snapshot.operations.filter(belongs);
	const operationIds = new Set(operations.map((row) => row.id));
	return {
		...snapshot,
		conversations,
		sessions: snapshot.sessions.filter((row) => visibleConversations.has(row.conversation_id)),
		tasks,
		turns: snapshot.turns.filter(belongs),
		questions: snapshot.questions.filter(belongs),
		inputs: snapshot.inputs.filter(belongs),
		events: snapshot.events.filter(belongs),
		operations,
		recoveries: snapshot.recoveries.filter(belongs),
		records: snapshot.records.filter(belongs),
		dependencies: snapshot.dependencies.filter((row) => belongs(row) && !hidden.has(row.dependency_id)),
		reservations: snapshot.reservations.filter((row) => operationIds.has(row.operation_id)),
	};
}
