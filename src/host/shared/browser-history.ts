import { browserRootsView } from "./conversation-snapshot.js";
import type { Row } from "./journal.js";

type Value = string | number | null;
export interface HistoryDatabase {
	exec(sql: string): void;
	prepare(sql: string): {
		get(...values: Value[]): Row | undefined;
		all(...values: Value[]): Row[];
		run(...values: Value[]): unknown;
	};
}

/** Rebuildable display projection. Recovery and exports always use the original events. */
export class BrowserHistory {
	constructor(private readonly db: HistoryDatabase) {
		db.exec(`${browserRootsView}
CREATE TABLE IF NOT EXISTS browser_events (
 slot TEXT PRIMARY KEY, id INTEGER NOT NULL, task_id TEXT NOT NULL,
 turn_id TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS browser_events_task ON browser_events(task_id, id);
CREATE INDEX IF NOT EXISTS browser_events_turn ON browser_events(turn_id, slot);
CREATE INDEX IF NOT EXISTS tasks_conversation ON tasks(conversation_id);
CREATE INDEX IF NOT EXISTS tasks_root ON tasks(root_task_id);
CREATE INDEX IF NOT EXISTS tasks_parent ON tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS tasks_queued ON tasks(state, cancellation_requested);
CREATE INDEX IF NOT EXISTS turns_task ON turns(task_id);
CREATE INDEX IF NOT EXISTS questions_task ON questions(task_id);
CREATE INDEX IF NOT EXISTS inputs_task ON inputs(task_id);
CREATE INDEX IF NOT EXISTS records_task ON records(task_id);
CREATE INDEX IF NOT EXISTS recovery_task ON recovery_dispositions(task_id);
CREATE TABLE IF NOT EXISTS browser_history_cursor (id INTEGER PRIMARY KEY CHECK(id=1), cursor INTEGER NOT NULL);
INSERT OR IGNORE INTO browser_history_cursor VALUES (1, 0);
`);
		// Old journals are replayed in small batches, never loaded wholesale into JS.
		let cursor = Number(db.prepare("SELECT cursor FROM browser_history_cursor WHERE id=1").get()!.cursor);
		while (true) {
			const rows = db.prepare("SELECT * FROM events WHERE id>? ORDER BY id LIMIT 100").all(cursor);
			if (!rows.length) break;
			db.exec("BEGIN IMMEDIATE");
			try {
				for (const row of rows) this.append(row);
				db.exec("COMMIT");
			} catch (error) { db.exec("ROLLBACK"); throw error; }
			cursor = Number(rows.at(-1)!.id);
		}
	}

	append(row: Row): void {
		this.db.prepare("UPDATE browser_history_cursor SET cursor=? WHERE id=1").run(row.id);
		if (row.kind !== "progress") return;
		const payload = JSON.parse(String(row.payload));
		const turn = String(payload.turnId ?? row.task_id);
		let slot: string;
		if (payload.type === "messages") {
			this.db.prepare("DELETE FROM browser_events WHERE turn_id=?").run(turn);
			slot = `messages:${turn}`;
		} else if (payload.type === "tool_progress") {
			// Keep call arguments and only its newest result/partial result.
			slot = `tool:${turn}:${payload.toolCallId}:${payload.phase === "started" ? "start" : "result"}`;
		} else if (payload.type === "agent_event") {
			const event = payload.event;
			const update = event?.assistantMessageEvent;
			if (event?.type === "message_update" && update?.type === "toolcall_start" && update.id) {
				// Keep generation visible while argument deltas are compacted. Execution
				// replaces this same slot with the tool's arguments and running state.
				slot = `tool:${turn}:${update.id}:start`;
				payload.type = "tool_progress";
				payload.phase = "generating";
				payload.toolCallId = update.id;
				payload.toolName = update.toolName;
			} else if (event?.type === "message_start" && event.message?.role === "assistant") {
				slot = `assistant:${turn}:${row.id}`;
				payload.type = "assistant_message";
				payload.message = event.message;
				payload.streaming = true;
			} else if (event?.type === "message_update" || (event?.type === "message_end" && event.message?.role === "assistant")) {
				const previous = this.db.prepare("SELECT * FROM browser_events WHERE turn_id=? AND slot LIKE 'assistant:%' ORDER BY id DESC LIMIT 1").get(turn);
				if (!previous) return;
				slot = String(previous.slot);
				const saved = JSON.parse(String(previous.payload));
				payload.type = "assistant_message";
				payload.message = event.type === "message_end" ? event.message : saved.message;
				payload.streaming = event.type !== "message_end";
				if (event.type === "message_update") {
					const update = event.assistantMessageEvent ?? {};
					const index = Number(update.contentIndex ?? 0);
					const content = payload.message.content ??= [];
					if (Number.isSafeInteger(index) && index >= 0 && index < 10_000) {
						while (content.length <= index) content.push({ type: "text", text: "" });
						if (update.type === "text_delta" || update.type === "thinking_delta") {
							const type = update.type === "text_delta" ? "text" : "thinking";
							if (content[index]?.type !== type) content[index] = { type, [type]: "" };
							const part = content[index];
							part[type] = String(part[type] ?? "") + String(update.delta ?? update.text ?? "");
						} else if (update.type === "toolcall_end" && update.toolCall) content[index] = update.toolCall;
					}
				}
				// Preserve message ordering and identity as its content changes.
				row = { ...row, id: previous.id, created_at: previous.created_at };
			} else return;
			if (payload.type === "assistant_message") payload.messageId = slot;
			delete payload.event;
		} else {
			// Display diagnostics need only their latest value per turn/type.
			slot = `status:${turn}:${payload.type}`;
		}
		this.db.prepare(`INSERT INTO browser_events(slot,id,task_id,turn_id,kind,payload,created_at)
VALUES (?,?,?,?,?,?,?) ON CONFLICT(slot) DO UPDATE SET id=excluded.id,payload=excluded.payload`)
			.run(slot, row.id, row.task_id, turn, row.kind, JSON.stringify(payload), row.created_at ?? 0);
	}
}
