import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { validateTargetBinding, type TargetBinding } from "../../protocol/shared-execution.js";

// Keep the adapter local while the repository supports Node 20 type definitions.
// The runtime minimum is Node 22.19, which includes node:sqlite without a flag.
type Value = string | number | null;
type Row = Record<string, Value>;
interface Database {
	exec(sql: string): void;
	prepare(sql: string): {
		get(...values: Value[]): Row | undefined;
		all(...values: Value[]): Row[];
		run(...values: Value[]): { changes: number | bigint };
	};
	close(): void;
}

function canonical(value: unknown): string {
	if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
	if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
	if (Array.isArray(value)) return `[${Array.from(value, canonical).join(",")}]`;
	if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
		return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
	}
	throw new Error("Journal payload must contain only JSON values");
}
function required(value: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error("Journal IDs must be nonempty strings");
	return value;
}

export interface Submission {
	requestId: string;
	conversationId: string;
	sessionId: string;
	kind: "prompt" | "follow_up";
	text: string;
	bindings: readonly TargetBinding[];
	attachments: readonly unknown[];
}
export interface Receipt { taskId: string; turnId: string; eventId: number }

/** Foundational journal. Not wired into the owned-child host or shared execution yet. */
export class TaskJournal {
	private readonly db: Database;
	constructor(path: string) {
		const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
			DatabaseSync: new (path: string) => Database;
		};
		this.db = new DatabaseSync(path);
		try {
			this.db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL;");
			this.transaction(() => {
				const version = Number(this.db.prepare("PRAGMA user_version").get()!.user_version);
				if (version > 1) throw new Error(`Unsupported shared journal version ${version}`);
				if (version === 1) return;
				this.db.exec(`
CREATE TABLE identity (id TEXT PRIMARY KEY);
CREATE TABLE conversations (id TEXT PRIMARY KEY);
CREATE TABLE sessions (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), UNIQUE(id, conversation_id));
CREATE TABLE tasks (
 id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, session_id TEXT NOT NULL,
 payload TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('queued','running','suspending','awaiting_user','completed','cancelled','interrupted','uncertain')),
 FOREIGN KEY(session_id, conversation_id) REFERENCES sessions(id, conversation_id)
);
CREATE TABLE turns (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id),
 state TEXT NOT NULL CHECK(state IN ('queued','running','suspended','completed','cancelled','interrupted','uncertain')),
 cleanup_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(cleanup_confirmed IN (0,1)),
 UNIQUE(id, task_id)
);
CREATE UNIQUE INDEX one_active_turn ON turns(task_id) WHERE state IN ('queued','running');
CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL REFERENCES tasks(id), kind TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE requests (id TEXT PRIMARY KEY, hash TEXT NOT NULL, receipt TEXT NOT NULL);
CREATE TABLE questions (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL, turn_id TEXT NOT NULL, tool_call_id TEXT NOT NULL,
 payload TEXT NOT NULL, answer TEXT, continuation_id TEXT UNIQUE REFERENCES turns(id),
 FOREIGN KEY(turn_id, task_id) REFERENCES turns(id, task_id), UNIQUE(turn_id, tool_call_id)
);
CREATE UNIQUE INDEX one_pending_question ON questions(task_id) WHERE answer IS NULL;
CREATE TABLE inputs (
 id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, turn_id TEXT NOT NULL, payload TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('accepted','delivering','applied','not_applied','unknown')),
 FOREIGN KEY(turn_id, task_id) REFERENCES turns(id, task_id)
);
PRAGMA user_version = 1;`);
				this.db.prepare("INSERT INTO identity VALUES (?)").run(randomUUID());
			});
		} catch (error) { this.db.close(); throw error; }
	}
	close(): void { this.db.close(); }
	get identity(): string { return String(this.db.prepare("SELECT id FROM identity").get()!.id); }
	private transaction<T>(work: () => T): T {
		this.db.exec("BEGIN IMMEDIATE");
		try { const result = work(); this.db.exec("COMMIT"); return result; }
		catch (error) { this.db.exec("ROLLBACK"); throw error; }
	}
	private event(taskId: string, kind: string, payload: unknown): number {
		this.db.prepare("INSERT INTO events(task_id,kind,payload) VALUES (?,?,?)").run(taskId, kind, canonical(payload));
		return Number(this.db.prepare("SELECT last_insert_rowid() AS id").get()!.id);
	}
	private request<T>(requestId: string, payload: unknown, work: () => T): T {
		required(requestId);
		const hash = createHash("sha256").update(canonical(payload)).digest("hex");
		return this.transaction(() => {
			const prior = this.db.prepare("SELECT * FROM requests WHERE id=?").get(requestId);
			if (prior) {
				if (prior.hash !== hash) throw new Error("Request ID conflicts with a different payload");
				return JSON.parse(String(prior.receipt)) as T;
			}
			const receipt = work();
			this.db.prepare("INSERT INTO requests VALUES (?,?,?)").run(requestId, hash, canonical(receipt));
			return receipt;
		});
	}
	registerSession(conversationId: string, sessionId: string): void {
		required(conversationId); required(sessionId);
		this.transaction(() => {
			this.db.prepare("INSERT OR IGNORE INTO conversations VALUES (?)").run(conversationId);
			this.db.prepare("INSERT OR IGNORE INTO sessions VALUES (?,?)").run(sessionId, conversationId);
			if (this.db.prepare("SELECT conversation_id FROM sessions WHERE id=?").get(sessionId)!.conversation_id !== conversationId)
				throw new Error("Session belongs to another conversation");
		});
	}
	accept(input: Submission): Receipt {
		required(input.conversationId); required(input.sessionId);
		if (typeof input.text !== "string" || !Array.isArray(input.bindings) || !Array.isArray(input.attachments)) throw new Error("Invalid submission");
		for (const binding of input.bindings) if (!validateTargetBinding(binding).ok) throw new Error("Invalid target binding");
		if (input.kind !== "prompt" && input.kind !== "follow_up") throw new Error("Invalid submission kind");
		return this.request(input.requestId, input, () => {
			const taskId = randomUUID(), turnId = randomUUID();
			this.db.prepare("INSERT INTO tasks VALUES (?,?,?,?, 'queued')").run(taskId, input.conversationId, input.sessionId, canonical(input));
			this.db.prepare("INSERT INTO turns(id,task_id,state) VALUES (?,?,'queued')").run(turnId, taskId);
			return { taskId, turnId, eventId: this.event(taskId, "message_accepted", { turnId }) };
		});
	}
	private expect(taskId: string, turnId: string, state: string): void {
		const row = this.db.prepare("SELECT t.state AS task_state,r.state AS turn_state FROM tasks t JOIN turns r ON r.task_id=t.id WHERE t.id=? AND r.id=?").get(taskId, turnId);
		if (!row || row.task_state !== state || row.turn_state !== state) throw new Error(`Task and turn must be ${state}`);
	}
	/** Commit model-start intent before invoking Pi. Never auto-replay a running turn. */
	start(taskId: string, turnId: string): void {
		this.transaction(() => {
			this.expect(taskId, turnId, "queued");
			const busy = this.db.prepare("SELECT id FROM tasks WHERE conversation_id=(SELECT conversation_id FROM tasks WHERE id=?) AND (state IN ('running','suspending','awaiting_user','uncertain') OR (state='queued' AND rowid<(SELECT rowid FROM tasks WHERE id=?))) AND id<>?").get(taskId, taskId, taskId);
			if (busy) throw new Error("Conversation has active or unresolved work");
			this.db.prepare("UPDATE tasks SET state='running' WHERE id=?").run(taskId);
			this.db.prepare("UPDATE turns SET state='running' WHERE id=?").run(turnId);
			this.event(taskId, "turn_started", { turnId });
		});
	}
	ask(taskId: string, turnId: string, toolCallId: string, payload: unknown): string {
		required(toolCallId);
		return this.transaction(() => {
			this.expect(taskId, turnId, "running");
			const id = randomUUID();
			this.db.prepare("INSERT INTO questions(id,task_id,turn_id,tool_call_id,payload) VALUES (?,?,?,?,?)").run(id, taskId, turnId, toolCallId, canonical(payload));
			this.db.prepare("UPDATE tasks SET state='suspending' WHERE id=?").run(taskId);
			this.event(taskId, "question_pending_cleanup", { questionId: id, turnId });
			return id;
		});
	}
	/** Caller must stop the driver, settle native work, and verify both scopes closed. */
	confirmSuspension(taskId: string, turnId: string): void {
		this.transaction(() => {
			const row = this.db.prepare("SELECT state FROM tasks WHERE id=?").get(taskId);
			const turn = this.db.prepare("SELECT state FROM turns WHERE task_id=? AND id=?").get(taskId, turnId);
			if (row?.state !== "suspending" || turn?.state !== "running") throw new Error("No suspension pending");
			this.db.prepare("UPDATE turns SET state='suspended',cleanup_confirmed=1 WHERE id=?").run(turnId);
			this.db.prepare("UPDATE tasks SET state='awaiting_user' WHERE id=?").run(taskId);
			this.retireInputs(turnId);
			this.event(taskId, "awaiting_user", { turnId });
		});
	}
	answer(requestId: string, questionId: string, answer: unknown): Receipt {
		return this.request(requestId, { kind: "answer", questionId, answer }, () => {
			const q = this.db.prepare("SELECT q.*,t.state FROM questions q JOIN tasks t ON t.id=q.task_id WHERE q.id=?").get(questionId);
			if (!q || q.state !== "awaiting_user" || q.answer !== null) throw new Error("Question is not answerable");
			const taskId = String(q.task_id), turnId = randomUUID();
			this.db.prepare("INSERT INTO turns(id,task_id,state) VALUES (?,?,'queued')").run(turnId, taskId);
			this.db.prepare("UPDATE questions SET answer=?,continuation_id=? WHERE id=?").run(canonical(answer), turnId, questionId);
			this.db.prepare("UPDATE tasks SET state='queued' WHERE id=?").run(taskId);
			return { taskId, turnId, eventId: this.event(taskId, "answer_accepted", { questionId, turnId, answer }) };
		});
	}
	steer(requestId: string, taskId: string, sessionId: string, turnId: string, payload: unknown): { inputId: number } {
		return this.request(requestId, { kind: "steer", taskId, sessionId, turnId, payload }, () => {
			this.expect(taskId, turnId, "running");
			if (this.db.prepare("SELECT session_id FROM tasks WHERE id=?").get(taskId)!.session_id !== sessionId) throw new Error("Wrong session");
			this.db.prepare("INSERT INTO inputs(task_id,turn_id,payload,state) VALUES (?,?,?,'accepted')").run(taskId, turnId, canonical(payload));
			const inputId = Number(this.db.prepare("SELECT last_insert_rowid() AS id").get()!.id);
			this.event(taskId, "steer_accepted", { inputId, turnId });
			return { inputId };
		});
	}
	markInput(inputId: number, state: "delivering" | "applied"): void {
		this.transaction(() => {
			const input = this.db.prepare("SELECT * FROM inputs WHERE id=?").get(inputId);
			if (!input) throw new Error("Unknown input");
			this.expect(String(input.task_id), String(input.turn_id), "running");
			if (state !== "delivering" && state !== "applied") throw new Error("Invalid delivery state");
			if (state === "delivering" && this.db.prepare("SELECT id FROM inputs WHERE turn_id=? AND id<? AND state IN ('accepted','delivering','unknown')").get(input.turn_id, inputId)) throw new Error("Earlier steering input has not settled");
			const prior = state === "delivering" ? "accepted" : "delivering";
			if (!this.db.prepare("UPDATE inputs SET state=? WHERE id=? AND state=?").run(state, inputId, prior).changes) throw new Error("Invalid delivery transition");
			this.event(String(input.task_id), `steer_${state}`, { inputId });
		});
	}
	private retireInputs(turnId: string): void {
		this.db.prepare("UPDATE inputs SET state=CASE state WHEN 'accepted' THEN 'not_applied' ELSE 'unknown' END WHERE turn_id=? AND state IN ('accepted','delivering')").run(turnId);
	}
	/** Only use once operation outcomes and native scope cleanup are confirmed. */
	settle(taskId: string, turnId: string, outcome: "completed" | "cancelled"): void {
		this.transaction(() => {
			const task = this.db.prepare("SELECT state FROM tasks WHERE id=?").get(taskId);
			const turn = this.db.prepare("SELECT state FROM turns WHERE id=? AND task_id=?").get(turnId, taskId);
			if (this.db.prepare("SELECT id FROM turns WHERE task_id=? ORDER BY rowid DESC LIMIT 1").get(taskId)?.id !== turnId) throw new Error("Turn is no longer current");
			if (outcome !== "completed" && outcome !== "cancelled") throw new Error("Invalid settlement outcome");
			if (!task || !turn || !["queued", "running", "suspending", "awaiting_user"].includes(String(task.state)) || !["queued", "running", "suspended"].includes(String(turn.state))) throw new Error("Task cannot settle");
			if (turn.state !== task.state && !(task.state === "suspending" && turn.state === "running") && !(task.state === "awaiting_user" && turn.state === "suspended")) throw new Error("Turn is no longer current");
			if (outcome === "completed" && (task.state !== "running" || turn.state !== "running")) throw new Error("Only running work can complete");
			this.db.prepare("UPDATE tasks SET state=? WHERE id=?").run(outcome, taskId);
			this.db.prepare("UPDATE turns SET state=?,cleanup_confirmed=1 WHERE id=?").run(outcome, turnId);
			this.retireInputs(turnId);
			this.event(taskId, outcome, { turnId });
		});
	}
	/** Until operation reconciliation exists, conservatively retain all possibly-started work as uncertain. */
	recover(): void {
		this.transaction(() => {
			for (const row of this.db.prepare("SELECT id,task_id FROM turns WHERE state='running'").all()) {
				this.db.prepare("UPDATE turns SET state='uncertain' WHERE id=?").run(row.id);
				this.db.prepare("UPDATE tasks SET state='uncertain' WHERE id=?").run(row.task_id);
				this.retireInputs(String(row.id));
				this.event(String(row.task_id), "recovery_required", { turnId: row.id });
			}
		});
	}
	snapshot(): { tasks: Row[]; turns: Row[]; questions: Row[]; inputs: Row[]; events: Row[] } {
		return this.transaction(() => ({
			tasks: this.db.prepare("SELECT * FROM tasks ORDER BY rowid").all(),
			turns: this.db.prepare("SELECT * FROM turns ORDER BY rowid").all(),
			questions: this.db.prepare("SELECT * FROM questions ORDER BY rowid").all(),
			inputs: this.db.prepare("SELECT * FROM inputs ORDER BY id").all(),
			events: this.db.prepare("SELECT * FROM events ORDER BY id").all(),
		}));
	}
}
