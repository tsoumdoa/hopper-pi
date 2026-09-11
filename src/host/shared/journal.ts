import { browserConversationsQuery, browserRecoveryTasksQuery } from "./conversation-snapshot.js";
import { BrowserHistory } from "./browser-history.js";
import { createHash, randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { dirname, join, basename, resolve } from "node:path";
import { createRequire } from "node:module";
import { classifyOperation, type OperationName } from "../../protocol/v2.js";
import {
	validateDocumentActionOwner,
	validateExecutionOwner,
	validateTargetBinding,
	type TargetBinding,
} from "../../protocol/shared-execution.js";

// Keep the adapter local while the repository supports Node 20 type definitions.
// The runtime minimum is Node 22.19, which includes node:sqlite without a flag.
type Value = string | number | null;
export type Row = Record<string, Value>;
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
	if (value === null || typeof value === "string" || typeof value === "boolean")
		return JSON.stringify(value);
	if (typeof value === "number" && Number.isFinite(value))
		return JSON.stringify(value);
	if (Array.isArray(value))
		return `[${Array.from(value, canonical).join(",")}]`;
	if (
		typeof value === "object" &&
		Object.getPrototypeOf(value) === Object.prototype
	) {
		return `{${Object.keys(value)
			.sort()
			.map(
				(key) =>
					`${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
			)
			.join(",")}}`;
	}
	throw new Error("Journal payload must contain only JSON values");
}
function required(value: string): string {
	if (typeof value !== "string" || !value.trim())
		throw new Error("Journal IDs must be nonempty strings");
	return value;
}

export interface Submission {
	requestId: string;
	conversationId: string;
	sessionId: string;
	kind: "prompt" | "follow_up";
	text: string;
	bindings: readonly TargetBinding[];
	/** Starting document for the message; bindings capture all documents it may access. */
	messageTarget?: TargetBinding;
	attachments: readonly unknown[];
	/** Internal acceptance scripts only; browser submissions cannot set this. */
	diagnosticFixture?: "shared-host-native-smoke";
}
export interface Receipt {
	taskId: string;
	turnId: string;
	eventId: number;
}

/** SQLite is the authority for accepted work, dispatch intent, and recovery. */
export class TaskJournal {
	static readonly schemaVersion = 6;
	private readonly sessionDirectory: string | undefined;
	conversationRevision = 0;
	private readonly db: Database;
	private readonly browserHistory: BrowserHistory;
	constructor(private readonly path: string) {
		this.sessionDirectory = path === ":memory:" ? undefined : join(dirname(path), "sessions");
		const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
			DatabaseSync: new (path: string) => Database;
		};
		this.db = new DatabaseSync(path);
		try {
			this.db.exec(
				"PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL;",
			);
			this.transaction(() => {
				const version = Number(
					this.db.prepare("PRAGMA user_version").get()!.user_version,
				);
				if (version > TaskJournal.schemaVersion)
					throw new Error(`Unsupported shared journal version ${version}`);
				if (version >= 1) return;
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
			this.transaction(() => {
				if (
					Number(this.db.prepare("PRAGMA user_version").get()!.user_version) >=
					2
				)
					return;
				this.db.exec(`
ALTER TABLE tasks ADD COLUMN parent_task_id TEXT REFERENCES tasks(id);
ALTER TABLE tasks ADD COLUMN root_task_id TEXT REFERENCES tasks(id);
ALTER TABLE tasks ADD COLUMN cancellation_requested INTEGER NOT NULL DEFAULT 0;
ALTER TABLE turns ADD COLUMN owner TEXT;
ALTER TABLE turns ADD COLUMN usage REAL NOT NULL DEFAULT 0;
CREATE TABLE dependencies(task_id TEXT NOT NULL REFERENCES tasks(id), dependency_id TEXT NOT NULL REFERENCES tasks(id), PRIMARY KEY(task_id,dependency_id));
CREATE TABLE operations(id TEXT PRIMARY KEY,task_id TEXT NOT NULL,turn_id TEXT NOT NULL,owner TEXT, name TEXT NOT NULL,class TEXT NOT NULL,arguments TEXT NOT NULL,hash TEXT NOT NULL,wire_id TEXT UNIQUE,deadline INTEGER NOT NULL,state TEXT NOT NULL,result TEXT, FOREIGN KEY(turn_id,task_id) REFERENCES turns(id,task_id));
CREATE TABLE recovery_dispositions(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),payload TEXT NOT NULL);
CREATE TABLE attachments(lifecycle_id TEXT PRIMARY KEY,payload TEXT NOT NULL);
CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,task_id TEXT NOT NULL REFERENCES tasks(id),payload TEXT NOT NULL,state TEXT NOT NULL, PRIMARY KEY(kind,id));
CREATE TABLE reservations(destination TEXT PRIMARY KEY,operation_id TEXT NOT NULL REFERENCES operations(id),baseline TEXT NOT NULL);
PRAGMA user_version = 2;`);
			});
			this.transaction(() => {
				if (
					Number(this.db.prepare("PRAGMA user_version").get()!.user_version) >=
					3
				)
					return;
				this.db.exec(
					"ALTER TABLE conversations ADD COLUMN title TEXT NOT NULL DEFAULT ''; ALTER TABLE conversations ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0; ALTER TABLE sessions ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0; PRAGMA user_version=3;",
				);
			});
			if (
				Number(this.db.prepare("PRAGMA user_version").get()!.user_version) < 4
			) {
				this.db.exec("PRAGMA foreign_keys=OFF");
				try {
					this.transaction(() => {
						for (const table of ["tasks", "turns"]) {
							const schema = String(
								this.db
									.prepare(
										"SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
									)
									.get(table)!.sql,
							);
							this.db.exec(
								schema
									.replace(`CREATE TABLE ${table}`, `CREATE TABLE ${table}_v4`)
									.replace(
										"'interrupted','uncertain'",
										"'interrupted','failed','uncertain'",
									),
							);
							this.db.exec(
								`INSERT INTO ${table}_v4 SELECT * FROM ${table}; DROP TABLE ${table}; ALTER TABLE ${table}_v4 RENAME TO ${table};`,
							);
						}
						this.db.exec(
							"CREATE UNIQUE INDEX one_active_turn ON turns(task_id) WHERE state IN ('queued','running'); PRAGMA user_version=4;",
						);
						if (this.db.prepare("PRAGMA foreign_key_check").all().length)
							throw new Error("Journal migration foreign key check failed");
					});
				} finally {
					this.db.exec("PRAGMA foreign_keys=ON");
				}
			}
			this.transaction(() => {
				if (
					Number(this.db.prepare("PRAGMA user_version").get()!.user_version) >=
					5
				)
					return;
				this.db.exec(`
ALTER TABLE tasks ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE turns ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE turns ADD COLUMN started_at INTEGER;
ALTER TABLE turns ADD COLUMN ended_at INTEGER;
ALTER TABLE operations ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE operations ADD COLUMN ended_at INTEGER;
ALTER TABLE events ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
CREATE TRIGGER task_created AFTER INSERT ON tasks BEGIN UPDATE tasks SET created_at=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),updated_at=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) WHERE id=NEW.id; END;
CREATE TRIGGER task_updated AFTER UPDATE OF state,cancellation_requested ON tasks BEGIN UPDATE tasks SET updated_at=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) WHERE id=NEW.id; END;
CREATE TRIGGER turn_created AFTER INSERT ON turns BEGIN UPDATE turns SET created_at=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),started_at=CASE WHEN NEW.state='running' THEN CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) ELSE NULL END WHERE id=NEW.id; END;
CREATE TRIGGER turn_updated AFTER UPDATE OF state ON turns BEGIN UPDATE turns SET started_at=CASE WHEN NEW.state='running' THEN COALESCE(started_at,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)) ELSE started_at END,ended_at=CASE WHEN NEW.state IN ('suspended','completed','failed','cancelled','interrupted','uncertain') THEN CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) ELSE ended_at END WHERE id=NEW.id; END;
CREATE TRIGGER operation_created AFTER INSERT ON operations BEGIN UPDATE operations SET created_at=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) WHERE id=NEW.id; END;
CREATE TRIGGER operation_updated AFTER UPDATE OF state ON operations BEGIN UPDATE operations SET ended_at=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) WHERE id=NEW.id; END;
CREATE TRIGGER event_created AFTER INSERT ON events BEGIN UPDATE events SET created_at=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) WHERE id=NEW.id; END;
PRAGMA user_version=5;`);
			});
			this.transaction(() => {
				if (Number(this.db.prepare("PRAGMA user_version").get()!.user_version) < 6)
					this.db.exec(`ALTER TABLE conversations ADD COLUMN archived_at INTEGER;
ALTER TABLE conversations ADD COLUMN document_label TEXT;
CREATE TABLE conversation_sequence (value INTEGER NOT NULL);
INSERT INTO conversation_sequence SELECT COALESCE(MAX(rowid),0) FROM conversations;
CREATE TRIGGER conversation_created AFTER INSERT ON conversations BEGIN
 UPDATE conversations SET rowid=MAX(NEW.rowid,(SELECT value+1 FROM conversation_sequence)) WHERE id=NEW.id;
 UPDATE conversation_sequence SET value=(SELECT MAX(rowid) FROM conversations);
END;
CREATE TABLE deleted_conversation_files (id TEXT PRIMARY KEY);
PRAGMA user_version=6;`);
			});
			this.browserHistory = new BrowserHistory(this.db);
			this.cleanupDeletedConversationFiles();
		} catch (error) {
			this.db.close();
			throw error;
		}
	}
	close(): void {
		this.db.close();
	}
	get identity(): string {
		return String(this.db.prepare("SELECT id FROM identity").get()!.id);
	}
	get lastConversationSequence(): number {
		return Number(this.db.prepare("SELECT value AS sequence FROM conversation_sequence").get()!.sequence);
	}
	private transaction<T>(work: () => T): T {
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const result = work();
			this.db.exec("COMMIT");
			return result;
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}
	private event(taskId: string, kind: string, payload: unknown): number {
		const task = this.db
			.prepare(
				"SELECT conversation_id,session_id,parent_task_id,root_task_id FROM tasks WHERE id=?",
			)
			.get(taskId);
		if (!task) throw new Error("Event task does not exist");
		const fields =
			payload && typeof payload === "object" && !Array.isArray(payload)
				? (payload as Record<string, unknown>)
				: { data: payload };
		const requestedTurn =
			typeof fields.turnId === "string"
				? this.db
						.prepare("SELECT id,owner FROM turns WHERE id=? AND task_id=?")
						.get(fields.turnId, taskId)
				: undefined;
		const turn =
			requestedTurn ??
			this.db
				.prepare(
					"SELECT id,owner FROM turns WHERE task_id=? ORDER BY rowid DESC LIMIT 1",
				)
				.get(taskId);
		const owner = turn?.owner ? JSON.parse(String(turn.owner)) : null;
		const attributed = {
			...fields,
			conversationId: task.conversation_id,
			taskId,
			rootTaskId: task.root_task_id ?? taskId,
			parentTaskId: task.parent_task_id,
			sessionId: task.session_id,
			turnId: turn?.id ?? null,
			binding: owner?.binding ?? null,
		};
		this.db
			.prepare("INSERT INTO events(task_id,kind,payload) VALUES (?,?,?)")
			.run(taskId, kind, canonical(attributed));
		const id = Number(this.db.prepare("SELECT last_insert_rowid() AS id").get()!.id);
		this.browserHistory.append(this.db.prepare("SELECT * FROM events WHERE id=?").get(id)!);
		return id;
	}
	lookupRequest<T>(requestId: string, payload: unknown): T | undefined {
		return this.findRequest<T>(requestId, payload);
	}

	findRequest<T>(requestId: string, payload: unknown): T | undefined {
		required(requestId);
		const prior = this.db
			.prepare("SELECT hash,receipt FROM requests WHERE id=?")
			.get(requestId);
		if (!prior) return undefined;
		if (
			prior.hash !==
			createHash("sha256").update(canonical(payload)).digest("hex")
		)
			throw new Error("Request ID conflicts with a different payload");
		const receipt = JSON.parse(String(prior.receipt));
		if (receipt?.deleted) throw new Error("Thread was deleted; this request cannot be replayed");
		return receipt as T;
	}

	private request<T>(requestId: string, payload: unknown, work: () => T): T {
		required(requestId);
		const hash = createHash("sha256").update(canonical(payload)).digest("hex");
		return this.transaction(() => {
			const prior = this.db
				.prepare("SELECT * FROM requests WHERE id=?")
				.get(requestId);
			if (prior) {
				if (prior.hash !== hash)
					throw new Error("Request ID conflicts with a different payload");
				const receipt = JSON.parse(String(prior.receipt));
				if (receipt?.deleted) throw new Error("Thread was deleted; this request cannot be replayed");
				return receipt as T;
			}
			const receipt = work();
			this.db
				.prepare("INSERT INTO requests VALUES (?,?,?)")
				.run(requestId, hash, canonical(receipt));
			return receipt;
		});
	}
	createConversation(
		requestId: string,
		title: string,
	): { conversationId: string; sessionId: string } {
		if (typeof title !== "string")
			throw new Error("Invalid conversation title");
		return this.request(
			requestId,
			{ kind: "create_conversation", title },
			() => {
				const conversationId = randomUUID(),
					sessionId = randomUUID(),
					now = Date.now();
				this.db
					.prepare(
						"INSERT INTO conversations(id,title,created_at) VALUES (?,?,?)",
					)
					.run(conversationId, title, now);
				this.db
					.prepare(
						"INSERT INTO sessions(id,conversation_id,created_at) VALUES (?,?,?)",
					)
					.run(sessionId, conversationId, now);
				return { conversationId, sessionId };
			},
		);
	}

	private cleanupDeletedConversationFiles(): void {
		for (const row of this.db
			.prepare("SELECT id FROM deleted_conversation_files")
			.all()) {
			if (this.sessionDirectory)
				rmSync(join(this.sessionDirectory, String(row.id)), {
					recursive: true,
					force: true,
				});
			this.db
				.prepare("DELETE FROM deleted_conversation_files WHERE id=?")
				.run(row.id);
		}
	}

	get liveConversationId(): string | undefined {
		const row = this.db
			.prepare(
				"SELECT conversation_id FROM tasks WHERE parent_task_id IS NULL AND state IN ('queued','running','suspending','awaiting_user') ORDER BY CASE WHEN state='queued' THEN 1 ELSE 0 END,rowid LIMIT 1",
			)
			.get();
		return row ? String(row.conversation_id) : undefined;
	}
	assertWritableConversation(id: string): void {
		const row = this.db
			.prepare("SELECT archived_at FROM conversations WHERE id=?")
			.get(id);
		if (!row) throw new Error("Thread no longer exists");
		if (row.archived_at !== null)
			throw new Error("Unarchive this thread to continue");
		if (this.liveConversationId && this.liveConversationId !== id)
			throw Object.assign(
				new Error(
					"Hopper is working in another thread. Stop it or jump back to continue.",
				),
				{ code: "busy" },
			);
	}
	manageConversation(
		requestId: string,
		id: string,
		action:
			| "archive_conversation"
			| "unarchive_conversation"
			| "delete_conversation",
	) {
		// IDs are also directory names. Never let a client select a parent directory.
		if (
			!id ||
			id === "." ||
			id === ".." ||
			basename(id) !== id ||
			id.includes("\\")
		)
			throw new Error("Invalid thread ID");
		const result = this.request(
			requestId,
			{ action, conversationId: id },
			() => {
				const row = this.db
					.prepare("SELECT id FROM conversations WHERE id=?")
					.get(id);
				if (!row) throw new Error("Thread no longer exists");
				if (
					action !== "unarchive_conversation" &&
					this.db
						.prepare(
							"SELECT 1 FROM tasks WHERE conversation_id=? AND state IN ('queued','running','suspending','awaiting_user') LIMIT 1",
						)
						.get(id)
				)
					throw Object.assign(new Error("Stop the running thread first"), {
						code: "busy",
					});
				if (action === "delete_conversation") {
					this.deleteConversationRows(id);
				} else
					this.db
						.prepare("UPDATE conversations SET archived_at=? WHERE id=?")
						.run(action === "archive_conversation" ? Date.now() : null, id);
				return { conversationId: id };
			},
		);
		this.conversationRevision++;
		if (action === "delete_conversation")
			this.cleanupDeletedConversationFiles();
		return result;
	}

	get historyStorage() {
		return this.sessionDirectory
			? {
					journalPath: resolve(this.path),
					sessionsPath: resolve(this.sessionDirectory),
				}
			: undefined;
	}

	purgeArchivedConversations(
		requestId: string,
		conversationIds: string[],
		before: number | null,
	) {
		const result = this.request(
			requestId,
			{ action: "purge_archived_conversations", conversationIds, before },
			() => {
				const rows = new Map(
					this.db
						.prepare(browserConversationsQuery)
						.all()
						.map((row) => [row.id, row]),
				);
				// Check the exact previewed IDs again inside the deletion transaction.
				// A restored thread or activity outside the chosen period invalidates the batch.
				for (const id of conversationIds) {
					const row = rows.get(id);
					if (
						!row?.archived_at ||
						row.live_state ||
						row.recovery_required ||
						(before !== null && Number(row.last_activity_at) >= before)
					)
						throw new Error(
							"These threads changed. Close this dialog and review the cleanup again.",
						);
				}
				for (const id of conversationIds) this.deleteConversationRows(id);
				return { conversationIds };
			},
		);
		this.conversationRevision++;
		this.cleanupDeletedConversationFiles();
		return result;
	}

	/** Called only inside a request transaction. */
	private deleteConversationRows(id: string): void {
		if (
			!id ||
			id === "." ||
			id === ".." ||
			basename(id) !== id ||
			id.includes("\\")
		)
			throw new Error("Invalid thread ID");
		if (
			this.db
				.prepare(
					"SELECT 1 FROM tasks WHERE conversation_id=? AND state IN ('queued','running','suspending','awaiting_user') LIMIT 1",
				)
				.get(id)
		)
			throw new Error("Stop the running thread first");
		if (
			this.db
				.prepare(
					`SELECT 1 FROM (${browserRecoveryTasksQuery}) WHERE conversation_id=? LIMIT 1`,
				)
				.get(id)
		)
			throw new Error("Review interrupted work before deleting this thread");
		const tasks = "SELECT id FROM tasks WHERE conversation_id=?";
		this.db
			.prepare(
				`DELETE FROM reservations WHERE operation_id IN (SELECT id FROM operations WHERE task_id IN (${tasks}))`,
			)
			.run(id);
		this.db
			.prepare(
				`DELETE FROM dependencies WHERE task_id IN (${tasks}) OR dependency_id IN (${tasks})`,
			)
			.run(id, id);
		for (const table of [
			"questions",
			"inputs",
			"browser_events",
			"events",
			"operations",
			"recovery_dispositions",
			"records",
			"turns",
		])
			this.db
				.prepare(`DELETE FROM ${table} WHERE task_id IN (${tasks})`)
				.run(id);
		// Keep request tombstones so reconnect retries cannot replay deleted work.
		this.db
			.prepare(
				`UPDATE requests SET receipt=? WHERE json_extract(receipt,'$.conversationId')=? OR json_extract(receipt,'$.taskId') IN (${tasks})`,
			)
			.run(JSON.stringify({ deleted: true, conversationId: id }), id, id);
		this.db.prepare("DELETE FROM tasks WHERE conversation_id=?").run(id);
		this.db.prepare("DELETE FROM sessions WHERE conversation_id=?").run(id);
		this.db.prepare("DELETE FROM conversations WHERE id=?").run(id);
		this.db
			.prepare("INSERT OR IGNORE INTO deleted_conversation_files VALUES (?)")
			.run(id);
	}

	registerSession(conversationId: string, sessionId: string): void {
		required(conversationId);
		required(sessionId);
		this.transaction(() => {
			this.db
				.prepare("INSERT OR IGNORE INTO conversations(id) VALUES (?)")
				.run(conversationId);
			this.db
				.prepare(
					"INSERT OR IGNORE INTO sessions(id,conversation_id) VALUES (?,?)",
				)
				.run(sessionId, conversationId);
			if (
				this.db
					.prepare("SELECT conversation_id FROM sessions WHERE id=?")
					.get(sessionId)!.conversation_id !== conversationId
			)
				throw new Error("Session belongs to another conversation");
		});
	}
	accept(input: Submission): Receipt {
		required(input.conversationId);
		required(input.sessionId);
		if (
			typeof input.text !== "string" ||
			!Array.isArray(input.bindings) ||
			!Array.isArray(input.attachments)
		)
			throw new Error("Invalid submission");
		for (const binding of input.bindings)
			if (!validateTargetBinding(binding).ok)
				throw new Error("Invalid target binding");
		if (input.messageTarget && (!validateTargetBinding(input.messageTarget).ok ||
			!input.bindings.some((binding) => canonical(binding) === canonical(input.messageTarget))))
			throw new Error("Message document must be included in instance access");
		if (input.kind !== "prompt" && input.kind !== "follow_up")
			throw new Error("Invalid submission kind");
		return this.request(input.requestId, input, () => {
			this.assertWritableConversation(input.conversationId);
			const target = input.messageTarget ?? input.bindings[0];
			if (target) {
				const attachment = this.db.prepare("SELECT payload FROM attachments WHERE lifecycle_id=?").get(target.lifecycleInstanceId);
				const labels = attachment ? JSON.parse(String(attachment.payload)).documentLabels : undefined;
				const label = labels?.[target.kind === "rhino" ? target.rhinoDocumentId : target.grasshopperDocumentId];
				if (typeof label === "string") this.db.prepare("UPDATE conversations SET document_label=COALESCE(document_label,?) WHERE id=?").run(label,input.conversationId);
			}
			const taskId = randomUUID(),
				turnId = randomUUID();
			this.db
				.prepare(
					"INSERT INTO tasks(id,conversation_id,session_id,payload,state) VALUES (?,?,?,?, 'queued')",
				)
				.run(taskId, input.conversationId, input.sessionId, canonical(input));
			this.db
				.prepare("INSERT INTO turns(id,task_id,state) VALUES (?,?,'queued')")
				.run(turnId, taskId);
			return {
				taskId,
				turnId,
				eventId: this.event(taskId, "message_accepted", { turnId }),
			};
		});
	}
	setSchedulingBlock(taskId: string, reason: string | null, blockingTaskId?: string): void {
		this.transaction(() => {
			const prior = this.db
					.prepare(
						"SELECT payload,state FROM records WHERE kind='scheduling' AND id=?",
					)
					.get(taskId),
				state = reason ? "blocked" : "ready",
				payload = canonical({ reason, ...(blockingTaskId ? { blockingTaskId } : {}) });
			if (
				(prior?.state === state && prior.payload === payload) ||
				(!prior && !reason)
			)
				return;
			this.db
				.prepare(
					"INSERT INTO records VALUES ('scheduling',?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload,state=excluded.state",
				)
				.run(taskId, taskId, payload, state);
			this.event(
				taskId,
				reason ? "task_waiting_for_target" : "task_target_ready",
				{ reason, ...(blockingTaskId ? { blockingTaskId } : {}) },
			);
		});
	}

	finishAdmission(taskId: string, error?: string): void {
		this.transaction(() => {
			const record = this.db
				.prepare("SELECT state FROM records WHERE kind='admission' AND id=?")
				.get(taskId);
			if (!record) return;
			if (record.state !== "pending") return;
			const task = this.db
				.prepare("SELECT state FROM tasks WHERE id=?")
				.get(taskId);
			if (task?.state !== "queued")
				throw new Error("Task admission is no longer queued");
			if (!error) error = "This pending request uses a retired authorization workflow. Submit the request again.";
			this.db
				.prepare(
					"UPDATE records SET state=?,payload=? WHERE kind='admission' AND id=?",
				)
				.run(
					error ? "failed" : "ready",
					canonical({ error: error ?? null }),
					taskId,
				);
			if (error) {
				this.db
					.prepare("UPDATE tasks SET state='failed' WHERE id=?")
					.run(taskId);
				this.db
					.prepare(
						"UPDATE turns SET state='failed',cleanup_confirmed=1 WHERE task_id=? AND state='queued'",
					)
					.run(taskId);
			}
			this.event(taskId, error ? "admission_failed" : "admission_ready", {
				error: error ?? null,
			});
		});
	}

	private expect(taskId: string, turnId: string, state: string): void {
		const row = this.db
			.prepare(
				"SELECT t.state AS task_state,r.state AS turn_state FROM tasks t JOIN turns r ON r.task_id=t.id WHERE t.id=? AND r.id=?",
			)
			.get(taskId, turnId);
		if (!row || row.task_state !== state || row.turn_state !== state)
			throw new Error(`Task and turn must be ${state}`);
	}
	/** Commit model-start intent before invoking Pi. Never auto-replay a running turn. */
	start(taskId: string, turnId: string, owner: unknown = null): void {
		this.transaction(() => {
			this.expect(taskId, turnId, "queued");
			const current = this.db
				.prepare("SELECT * FROM tasks WHERE id=?")
				.get(taskId)!;
			if (
				this.db
					.prepare(
						"SELECT id FROM records WHERE kind='admission' AND task_id=? AND state<>'ready'",
					)
					.get(taskId)
			)
				throw new Error("Task authorization admission is incomplete");
			if (current.cancellation_requested)
				throw new Error("Task cancellation requested");
			if (owner !== null) {
				const parsed = validateExecutionOwner(owner),
					bindings = [
						...(JSON.parse(String(current.payload)) as Submission).bindings,
						...this.authorizationAdditions(taskId),
					];
				if (
					!parsed.ok ||
					parsed.value.taskId !== taskId ||
					parsed.value.turnId !== turnId ||
					!bindings.some(
						(binding) => canonical(binding) === canonical(parsed.value.binding),
					)
				)
					throw new Error("Turn execution owner is not authorized");
			}
			if (
				this.db
					.prepare(
						"SELECT d.dependency_id FROM dependencies d JOIN tasks t ON t.id=d.dependency_id WHERE d.task_id=? AND t.state<>'completed'",
					)
					.get(taskId)
			)
				throw new Error("Dependencies are not completed");
			if (current.parent_task_id === null) {
				const busy = this.db
					.prepare(
						"SELECT id FROM tasks WHERE parent_task_id IS NULL AND (state IN ('running','suspending','awaiting_user') OR (conversation_id=? AND state='uncertain' AND NOT EXISTS(SELECT 1 FROM recovery_dispositions r WHERE r.task_id=tasks.id)) OR (state='queued' AND rowid<(SELECT rowid FROM tasks WHERE id=?))) AND id<>?",
					)
					.get(current.conversation_id, taskId, taskId);
				if (busy) throw new Error("Conversation has active or unresolved work");
			}
			this.db
				.prepare("UPDATE turns SET owner=? WHERE id=?")
				.run(canonical(owner), turnId);
			this.db
				.prepare("UPDATE tasks SET state='running' WHERE id=?")
				.run(taskId);
			this.db
				.prepare("UPDATE turns SET state='running' WHERE id=?")
				.run(turnId);
			this.event(taskId, "turn_started", { turnId });
		});
	}
	ask(
		taskId: string,
		turnId: string,
		toolCallId: string,
		payload: unknown,
	): string {
		required(toolCallId);
		return this.transaction(() => {
			this.expect(taskId, turnId, "running");
			if (
				this.db
					.prepare("SELECT cancellation_requested FROM tasks WHERE id=?")
					.get(taskId)!.cancellation_requested
			)
				throw new Error("Task cancellation requested");
			const id = randomUUID();
			this.db
				.prepare(
					"INSERT INTO questions(id,task_id,turn_id,tool_call_id,payload) VALUES (?,?,?,?,?)",
				)
				.run(id, taskId, turnId, toolCallId, canonical(payload));
			this.db
				.prepare("UPDATE tasks SET state='suspending' WHERE id=?")
				.run(taskId);
			this.event(taskId, "question_pending_cleanup", {
				questionId: id,
				turnId,
			});
			return id;
		});
	}
	private unresolvedTurn(turnId: string): boolean {
		return (
			!!this.db
				.prepare(
					"SELECT id FROM operations WHERE turn_id=? AND state IN ('dispatched','uncertain')",
				)
				.get(turnId) ||
			this.db
				.prepare(
					"SELECT payload FROM records WHERE kind='scope' AND state='uncertain'",
				)
				.all()
				.some((record) => JSON.parse(String(record.payload)).turnId === turnId)
		);
	}

	/** Caller must stop the driver, settle native work, and verify both scopes closed. */
	confirmSuspension(taskId: string, turnId: string): void {
		this.transaction(() => {
			const row = this.db
				.prepare("SELECT state FROM tasks WHERE id=?")
				.get(taskId);
			const turn = this.db
				.prepare("SELECT state FROM turns WHERE task_id=? AND id=?")
				.get(taskId, turnId);
			if (row?.state !== "suspending" || turn?.state !== "running")
				throw new Error("No suspension pending");
			if (this.unresolvedTurn(turnId))
				throw new Error(
					"Cannot answer before operation and scope cleanup resolve",
				);
			this.db
				.prepare(
					"UPDATE turns SET state='suspended',cleanup_confirmed=1 WHERE id=?",
				)
				.run(turnId);
			this.db
				.prepare("UPDATE tasks SET state='awaiting_user' WHERE id=?")
				.run(taskId);
			this.retireInputs(turnId);
			this.event(taskId, "awaiting_user", { turnId });
		});
	}
	answer(requestId: string, questionId: string, answer: unknown): Receipt {
		return this.request(
			requestId,
			{ kind: "answer", questionId, answer },
			() => {
				const q = this.db
					.prepare(
						"SELECT q.*,t.state,t.cancellation_requested FROM questions q JOIN tasks t ON t.id=q.task_id WHERE q.id=?",
					)
					.get(questionId);
				if (
					!q ||
					q.state !== "awaiting_user" ||
					q.answer !== null ||
					q.cancellation_requested
				)
					throw new Error("Question is not answerable");
				const taskId = String(q.task_id),
					turnId = randomUUID();
				this.db
					.prepare("INSERT INTO turns(id,task_id,state) VALUES (?,?,'queued')")
					.run(turnId, taskId);
				this.db
					.prepare("UPDATE questions SET answer=?,continuation_id=? WHERE id=?")
					.run(canonical(answer), turnId, questionId);
				this.db
					.prepare("UPDATE tasks SET state='queued' WHERE id=?")
					.run(taskId);
				return {
					taskId,
					turnId,
					eventId: this.event(taskId, "answer_accepted", {
						questionId,
						turnId,
						answer,
					}),
				};
			},
		);
	}
	steer(
		requestId: string,
		taskId: string,
		sessionId: string,
		turnId: string,
		payload: unknown,
	): { inputId: number } {
		return this.request(
			requestId,
			{ kind: "steer", taskId, sessionId, turnId, payload },
			() => {
				this.expect(taskId, turnId, "running");
				if (
					this.db
						.prepare("SELECT cancellation_requested FROM tasks WHERE id=?")
						.get(taskId)!.cancellation_requested
				)
					throw new Error("Task cancelling");
				if (
					this.db
						.prepare("SELECT session_id FROM tasks WHERE id=?")
						.get(taskId)!.session_id !== sessionId
				)
					throw new Error("Wrong session");
				this.db
					.prepare(
						"INSERT INTO inputs(task_id,turn_id,payload,state) VALUES (?,?,?,'accepted')",
					)
					.run(taskId, turnId, canonical(payload));
				const inputId = Number(
					this.db.prepare("SELECT last_insert_rowid() AS id").get()!.id,
				);
				this.event(taskId, "steer_accepted", { inputId, turnId });
				return { inputId };
			},
		);
	}
	markInput(inputId: number, state: "delivering" | "applied"): void {
		this.transaction(() => {
			const input = this.db
				.prepare("SELECT * FROM inputs WHERE id=?")
				.get(inputId);
			if (!input) throw new Error("Unknown input");
			if (state === "delivering") {
				this.expect(String(input.task_id), String(input.turn_id), "running");
				if (
					this.db
						.prepare("SELECT cancellation_requested FROM tasks WHERE id=?")
						.get(input.task_id)!.cancellation_requested
				)
					throw new Error("Task cancellation requested");
			}
			if (state !== "delivering" && state !== "applied")
				throw new Error("Invalid delivery state");
			if (
				state === "delivering" &&
				this.db
					.prepare(
						"SELECT id FROM inputs WHERE turn_id=? AND id<? AND state IN ('accepted','delivering','unknown')",
					)
					.get(input.turn_id, inputId)
			)
				throw new Error("Earlier steering input has not settled");
			const prior =
				state === "delivering"
					? "accepted"
					: input.state === "unknown"
						? "unknown"
						: "delivering";
			if (
				!this.db
					.prepare("UPDATE inputs SET state=? WHERE id=? AND state=?")
					.run(state, inputId, prior).changes
			)
				throw new Error("Invalid delivery transition");
			this.event(String(input.task_id), `steer_${state}`, { inputId });
		});
	}
	markInputNotApplied(inputId: number): void {
		this.transaction(() => {
			const input = this.db
				.prepare("SELECT * FROM inputs WHERE id=?")
				.get(inputId);
			if (
				!input ||
				!["accepted", "delivering", "unknown"].includes(String(input.state))
			)
				throw new Error("Input application is already settled");
			this.db
				.prepare("UPDATE inputs SET state='not_applied' WHERE id=?")
				.run(inputId);
			this.event(String(input.task_id), "steer_not_applied", { inputId });
		});
	}
	markScopeUncertain(
		owner: unknown,
		taskId: string,
		turnId: string,
		evidence: unknown,
	): void {
		this.transaction(() => {
			this.db
				.prepare("INSERT INTO records VALUES ('scope',?,?,?,'uncertain')")
				.run(randomUUID(), taskId, canonical({ owner, turnId, evidence }));
			this.event(taskId, "scope_cleanup_uncertain", { turnId, evidence });
		});
	}

	private retireInputs(turnId: string): void {
		this.db
			.prepare(
				"UPDATE inputs SET state=CASE state WHEN 'accepted' THEN 'not_applied' ELSE 'unknown' END WHERE turn_id=? AND state IN ('accepted','delivering')",
			)
			.run(turnId);
	}
	/** Only use once operation outcomes and native scope cleanup are confirmed. */
	settle(
		taskId: string,
		turnId: string,
		outcome: "completed" | "cancelled",
	): void {
		this.transaction(() => {
			const task = this.db
				.prepare("SELECT state FROM tasks WHERE id=?")
				.get(taskId);
			const turn = this.db
				.prepare("SELECT state FROM turns WHERE id=? AND task_id=?")
				.get(turnId, taskId);
			if (
				this.db
					.prepare(
						"SELECT id FROM turns WHERE task_id=? ORDER BY rowid DESC LIMIT 1",
					)
					.get(taskId)?.id !== turnId
			)
				throw new Error("Turn is no longer current");
			if (outcome !== "completed" && outcome !== "cancelled")
				throw new Error("Invalid settlement outcome");
			if (
				!task ||
				!turn ||
				!["queued", "running", "suspending", "awaiting_user"].includes(
					String(task.state),
				) ||
				!["queued", "running", "suspended"].includes(String(turn.state))
			)
				throw new Error("Task cannot settle");
			if (
				turn.state !== task.state &&
				!(task.state === "suspending" && turn.state === "running") &&
				!(task.state === "awaiting_user" && turn.state === "suspended")
			)
				throw new Error("Turn is no longer current");
			if (
				outcome === "completed" &&
				(task.state !== "running" || turn.state !== "running")
			)
				throw new Error("Only running work can complete");
			if (this.unresolvedTurn(turnId))
				throw new Error("Operation or scope outcome unresolved");
			this.db
				.prepare("UPDATE tasks SET state=? WHERE id=?")
				.run(outcome, taskId);
			this.db
				.prepare("UPDATE turns SET state=?,cleanup_confirmed=1 WHERE id=?")
				.run(outcome, turnId);
			this.retireInputs(turnId);
			this.event(taskId, outcome, { turnId });
		});
	}
	/** Never replay possibly-started work; ownership reconciliation must release it explicitly. */
	recover(): void {
		// Retired pre-issued permissions must never dispatch after an upgrade.
		for (const row of this.db.prepare("SELECT r.task_id FROM records r JOIN tasks t ON t.id=r.task_id WHERE r.kind='admission' AND r.state='pending' AND t.state='queued'").all())
			this.finishAdmission(String(row.task_id), "This pending request uses a retired authorization workflow. Submit the request again.");
		this.transaction(() => {
			for (const row of this.db
				.prepare("SELECT id,task_id FROM turns WHERE state='running'")
				.all()) {
				this.db
					.prepare("UPDATE turns SET state='uncertain' WHERE id=?")
					.run(row.id);
				this.db
					.prepare("UPDATE tasks SET state='uncertain' WHERE id=?")
					.run(row.task_id);
				this.retireInputs(String(row.id));
				this.event(String(row.task_id), "recovery_required", {
					turnId: row.id,
				});
			}
		});
	}
	failQueued(taskId: string, turnId: string, reason: string): void {
		this.transaction(() => {
			this.expect(taskId, turnId, "queued");
			this.db.prepare("UPDATE tasks SET state='failed' WHERE id=?").run(taskId);
			this.db
				.prepare(
					"UPDATE turns SET state='failed',cleanup_confirmed=1 WHERE id=?",
				)
				.run(turnId);
			this.event(taskId, "failed", { turnId, reason });
		});
	}

	failRunning(taskId: string, turnId: string, reason: string): void {
		this.transaction(() => {
			this.expect(taskId, turnId, "running");
			if (this.unresolvedTurn(turnId))
				throw new Error("Unresolved native work must remain uncertain");
			this.db.prepare("UPDATE tasks SET state='failed' WHERE id=?").run(taskId);
			this.db
				.prepare(
					"UPDATE turns SET state='failed',cleanup_confirmed=1 WHERE id=?",
				)
				.run(turnId);
			this.retireInputs(turnId);
			this.event(taskId, "failed", { turnId, reason });
		});
	}

	requestCancellation(taskId: string, requestId?: string): string[] {
		const work = () => {
			const rows = this.db
				.prepare(
					"WITH RECURSIVE family(id) AS (SELECT id FROM tasks WHERE id=? UNION ALL SELECT t.id FROM tasks t JOIN family f ON t.parent_task_id=f.id) SELECT id FROM family",
				)
				.all(taskId);
			if (!rows.length) throw new Error("Unknown task");
			for (const row of rows) {
				this.db
					.prepare("UPDATE tasks SET cancellation_requested=1 WHERE id=?")
					.run(row.id);
				this.event(String(row.id), "cancellation_requested", {});
			}
			return rows.map((row) => String(row.id));
		};
		return requestId
			? this.request(requestId, { kind: "cancel", taskId }, work)
			: this.transaction(work);
	}
	uncertain(taskId: string, turnId: string, evidence: unknown): void {
		this.transaction(() => {
			if (
				this.db
					.prepare(
						"SELECT id FROM turns WHERE task_id=? ORDER BY rowid DESC LIMIT 1",
					)
					.get(taskId)?.id !== turnId
			)
				throw new Error("Turn is no longer current");
			this.db
				.prepare("UPDATE turns SET state='uncertain' WHERE id=? AND task_id=?")
				.run(turnId, taskId);
			this.db
				.prepare("UPDATE tasks SET state='uncertain' WHERE id=?")
				.run(taskId);
			this.retireInputs(turnId);
			this.event(taskId, "recovery_required", { turnId, evidence });
		});
	}
	recordUsage(taskId: string, turnId: string, usage: number): void {
		if (!Number.isFinite(usage) || usage < 0) throw new Error("Invalid usage");
		this.transaction(() => {
			if (
				!this.db
					.prepare("UPDATE turns SET usage=? WHERE id=? AND task_id=?")
					.run(usage, turnId, taskId).changes
			)
				throw new Error("Unknown turn");
			this.event(taskId, "usage", { turnId, usage });
		});
	}
	publish(taskId: string, payload: unknown): number {
		return this.transaction(() => this.event(taskId, "progress", payload));
	}
	delegate(
		input: Submission & { parentTaskId: string; dependencies: string[] },
	): Receipt {
		return this.request(
			input.requestId,
			{ ...input, command: "delegate" },
			() => {
				const parent = this.db
					.prepare("SELECT * FROM tasks WHERE id=?")
					.get(input.parentTaskId);
				if (
					!parent ||
					parent.parent_task_id !== null ||
					parent.state !== "running" ||
					parent.cancellation_requested ||
					parent.conversation_id !== input.conversationId
				)
					throw new Error("Delegation requires an active root coordinator");
				const authority = JSON.parse(String(parent.payload)) as Submission;
				if (
					input.bindings.length !== 1 ||
					![
						...authority.bindings,
						...this.authorizationAdditions(String(parent.id)),
					].some((b) => canonical(b) === canonical(input.bindings[0]))
				)
					throw new Error("Child binding is not authorized");
				for (const dependency of input.dependencies) {
					const row = this.db
						.prepare("SELECT parent_task_id FROM tasks WHERE id=?")
						.get(dependency);
					if (row?.parent_task_id !== parent.id)
						throw new Error("Dependency must be an existing sibling");
				}
				const taskId = randomUUID(),
					turnId = randomUUID();
				this.db
					.prepare(
						"INSERT INTO sessions(id,conversation_id,created_at) VALUES (?,?,?)",
					)
					.run(input.sessionId, input.conversationId, Date.now());
				this.db
					.prepare(
						"INSERT INTO tasks(id,conversation_id,session_id,payload,state,parent_task_id,root_task_id) VALUES (?,?,?,?,'queued',?,?)",
					)
					.run(
						taskId,
						input.conversationId,
						input.sessionId,
						canonical(input),
						parent.id,
						parent.id,
					);
				this.db
					.prepare("INSERT INTO turns(id,task_id,state) VALUES (?,?,'queued')")
					.run(turnId, taskId);
				for (const dependency of new Set(input.dependencies))
					this.db
						.prepare("INSERT INTO dependencies VALUES (?,?)")
						.run(taskId, dependency);
				return {
					taskId,
					turnId,
					eventId: this.event(taskId, "message_accepted", {
						turnId,
						parentTaskId: parent.id,
					}),
				};
			},
		);
	}
	operationIntent(input: {
		taskId: string;
		turnId: string;
		name: string;
		operationClass: "mutation" | "control";
		arguments: unknown;
		deadline: number;
		owner?: unknown;
		cleanup?: boolean;
		record?: { kind: string; id: string; expected: string; payload: unknown };
		grantId?: string;
		reservations?: { identity: string; baseline: unknown }[];
	}): { id: string; operationId?: string } {
		if (
			!["mutation", "control"].includes(input.operationClass) ||
			classifyOperation(input.name as OperationName) !== input.operationClass ||
			!Number.isSafeInteger(input.deadline)
		)
			throw new Error("Invalid operation dispatch policy");
		return this.transaction(() => {
			const task = this.db
				.prepare("SELECT state,cancellation_requested FROM tasks WHERE id=?")
				.get(input.taskId);
			const cleanupNames = [
				"commitAgentTransaction",
				"cancelAgentTransaction",
				"commitRhinoAgentTransaction",
				"cancelRhinoAgentTransaction",
			];
			if (input.cleanup) {
				const turn = this.db
					.prepare("SELECT state FROM turns WHERE id=? AND task_id=?")
					.get(input.turnId, input.taskId);
				if (
					!cleanupNames.includes(input.name) ||
					!task ||
					!["running", "suspending"].includes(String(task.state)) ||
					turn?.state !== "running"
				)
					throw new Error("Invalid cleanup dispatch");
			} else {
				this.expect(input.taskId, input.turnId, "running");
				if (task!.cancellation_requested)
					throw new Error("Task cancellation requested");
			}
			if (
				input.grantId &&
				!this.db
					.prepare(
						"UPDATE records SET state='in_flight' WHERE kind='grant' AND id=? AND task_id=? AND state='accepted'",
					)
					.run(input.grantId, input.taskId).changes
			)
				throw new Error("Grant already dispatched");
			if (input.owner !== undefined) {
				const parsed = validateExecutionOwner(input.owner);
				const taskRow = this.db
					.prepare("SELECT payload FROM tasks WHERE id=?")
					.get(input.taskId)!;
				const authorized = [
					...(JSON.parse(String(taskRow.payload)) as Submission).bindings,
					...this.authorizationAdditions(input.taskId),
				];
				if (parsed.ok) {
					const captured = this.db
						.prepare("SELECT owner FROM turns WHERE id=?")
						.get(input.turnId)!.owner;
					if (
						captured &&
						captured !== "null" &&
						canonical(JSON.parse(String(captured))) !== canonical(parsed.value)
					)
						throw new Error(
							"Operation cannot retarget its immutable turn owner",
						);
					if (
						parsed.value.taskId !== input.taskId ||
						parsed.value.turnId !== input.turnId ||
						!authorized.some(
							(binding) =>
								canonical(binding) === canonical(parsed.value.binding),
						)
					)
						throw new Error("Operation owner is not authorized");
				} else {
					const action = validateDocumentActionOwner(input.owner);
					if (
						!action.ok ||
						action.value.taskId !== input.taskId ||
						action.value.turnId !== input.turnId ||
						!["manageRhinoDocument", "manageGrasshopperDocument"].includes(
							input.name,
						)
					)
						throw new Error("Operation owner is not authorized");
					const grant = this.db
						.prepare("SELECT * FROM records WHERE kind='grant' AND id=?")
						.get(action.value.grantId);
					if (
						!grant ||
						grant.task_id !== input.taskId ||
						grant.state !== "in_flight" ||
						JSON.parse(String(grant.payload)).lifecycleInstanceId !==
							action.value.lifecycleInstanceId
					)
						throw new Error("Document action grant is not in flight");
				}
			}
			const owner =
				input.owner === undefined
					? this.db
							.prepare("SELECT owner FROM turns WHERE id=?")
							.get(input.turnId)!.owner
					: canonical(input.owner);
			const id = randomUUID(),
				wire = input.operationClass === "mutation" ? randomUUID() : null,
				args = canonical(input.arguments);
			this.db
				.prepare(
					"INSERT INTO operations(id,task_id,turn_id,owner,name,class,arguments,hash,wire_id,deadline,state,result) VALUES (?,?,?,?,?,?,?,?,?,?, 'dispatched',NULL)",
				)
				.run(
					id,
					input.taskId,
					input.turnId,
					owner,
					input.name,
					input.operationClass,
					args,
					createHash("sha256").update(args).digest("hex"),
					wire,
					input.deadline,
				);
			if (input.reservations?.length) {
				if (!owner || owner === "null")
					throw new Error("Reservation requires process ownership");
				for (const destination of [...input.reservations].sort((a, b) =>
					a.identity.localeCompare(b.identity),
				))
					this.db
						.prepare("INSERT INTO reservations VALUES (?,?,?)")
						.run(
							required(destination.identity),
							id,
							canonical(destination.baseline),
						);
			}
			if (input.record) {
				const record = input.record;
				if (
					!this.db
						.prepare(
							"UPDATE records SET state='dispatched',payload=? WHERE kind=? AND id=? AND task_id=? AND state=?",
						)
						.run(
							canonical({ operationId: id, data: record.payload }),
							record.kind,
							record.id,
							input.taskId,
							record.expected,
						).changes
				)
					throw new Error("Dispatch record state conflict");
			}
			this.event(input.taskId, "operation_dispatched", {
				id,
				turnId: input.turnId,
			});
			return wire ? { id, operationId: wire } : { id };
		});
	}
	operationResult(
		id: string,
		state: "completed" | "failed" | "cancelled" | "uncertain",
		result: unknown,
	): void {
		if (!["completed", "failed", "cancelled", "uncertain"].includes(state))
			throw new Error("Invalid operation result state");
		this.transaction(() => {
			const row = this.db
				.prepare("SELECT * FROM operations WHERE id=?")
				.get(id);
			if (!row || row.state !== "dispatched")
				throw new Error("Operation outcome already recorded or unknown");
			this.db
				.prepare("UPDATE operations SET state=?,result=? WHERE id=?")
				.run(state, canonical(result), id);
			if (state !== "uncertain")
				this.db
					.prepare("DELETE FROM reservations WHERE operation_id=?")
					.run(id);
			this.event(String(row.task_id), "operation_result", {
				id,
				state,
				result,
			});
		});
	}
	reserve(
		operationId: string,
		destinations: { identity: string; baseline: unknown }[],
	): void {
		this.transaction(() => {
			const op = this.db
				.prepare("SELECT owner,state FROM operations WHERE id=?")
				.get(operationId);
			if (!op || op.state !== "dispatched" || !op.owner || op.owner === "null")
				throw new Error(
					"Reservation requires live process operation ownership",
				);
			for (const destination of [...destinations].sort((a, b) =>
				a.identity.localeCompare(b.identity),
			)) {
				required(destination.identity);
				this.db
					.prepare("INSERT INTO reservations VALUES (?,?,?)")
					.run(
						destination.identity,
						operationId,
						canonical(destination.baseline),
					);
			}
		});
	}
	recoveryDisposition(
		requestId: string,
		taskId: string,
		evidence: {
			acknowledged: boolean;
			originalProcessExited?: boolean;
			authenticatedAndFenced?: boolean;
			operationsIdle?: boolean;
			scopesIdle?: boolean;
			inspectedBaseline: unknown;
			releaseReservations?: boolean;
			details?: unknown;
		},
		requestPayload?: unknown,
	): { id: string } {
		return this.request(
			requestId,
			requestPayload ?? { kind: "recovery", taskId, evidence },
			() => {
				if (
					this.db.prepare("SELECT state FROM tasks WHERE id=?").get(taskId)
						?.state !== "uncertain"
				)
					throw new Error("Task is not uncertain");
				if (
					evidence.acknowledged !== true ||
					!(
						evidence.originalProcessExited === true ||
						(evidence.authenticatedAndFenced === true &&
							evidence.operationsIdle === true &&
							evidence.scopesIdle === true)
					) ||
					evidence.inspectedBaseline == null
				)
					throw new Error(
						"Recovery requires acknowledgement, inspected baseline, and proof the old work cannot continue",
					);
				const id = randomUUID();
				this.db
					.prepare("INSERT INTO recovery_dispositions VALUES (?,?,?)")
					.run(id, taskId, canonical(evidence));
				if (evidence.releaseReservations === true)
					this.db
						.prepare(
							"DELETE FROM reservations WHERE operation_id IN (SELECT id FROM operations WHERE task_id=?)",
						)
						.run(taskId);
				this.event(taskId, "recovery_acknowledged", { id, evidence });
				return { id };
			},
		);
	}
	beginHandoff(taskId: string, turnId: string, grantId: string): string {
		return this.transaction(() => {
			this.expect(taskId, turnId, "running");
			const grant = this.db
				.prepare("SELECT * FROM records WHERE kind='grant' AND id=?")
				.get(grantId);
			if (
				!grant ||
				grant.task_id !== taskId ||
				grant.state !== "accepted" ||
				this.db
					.prepare("SELECT cancellation_requested FROM tasks WHERE id=?")
					.get(taskId)!.cancellation_requested
			)
				throw new Error("Handoff grant unavailable");
			const id = randomUUID();
			this.db
				.prepare("INSERT INTO records VALUES ('handoff',?,?,?,'suspending')")
				.run(id, taskId, canonical({ grantId, oldTurnId: turnId }));
			this.db
				.prepare("UPDATE tasks SET state='suspending' WHERE id=?")
				.run(taskId);
			this.event(taskId, "document_handoff_pending_cleanup", {
				handoffId: id,
				grantId,
				turnId,
			});
			return id;
		});
	}
	startHandoffAction(
		taskId: string,
		turnId: string,
		handoffId: string,
	): string {
		return this.transaction(() => {
			const handoff = this.db
				.prepare("SELECT * FROM records WHERE kind='handoff' AND id=?")
				.get(handoffId);
			if (
				!handoff ||
				handoff.task_id !== taskId ||
				handoff.state !== "suspending" ||
				JSON.parse(String(handoff.payload)).oldTurnId !== turnId
			)
				throw new Error("Handoff state conflict");
			const task = this.db
				.prepare("SELECT state,cancellation_requested FROM tasks WHERE id=?")
				.get(taskId);
			if (task?.state !== "suspending" || task.cancellation_requested)
				throw new Error(
					"Handoff task is not suspending or cancellation was requested",
				);
			if (this.unresolvedTurn(turnId))
				throw new Error("Handoff operations or scope cleanup unresolved");
			this.db
				.prepare(
					"UPDATE turns SET state='suspended',cleanup_confirmed=1 WHERE id=?",
				)
				.run(turnId);
			this.retireInputs(turnId);
			const actionTurnId = randomUUID();
			this.db
				.prepare(
					"INSERT INTO turns(id,task_id,state,owner) VALUES (?,?,'running','null')",
				)
				.run(actionTurnId, taskId);
			this.db
				.prepare("UPDATE tasks SET state='running' WHERE id=?")
				.run(taskId);
			this.db
				.prepare(
					"UPDATE records SET state='action_running',payload=? WHERE kind='handoff' AND id=?",
				)
				.run(
					canonical({ ...JSON.parse(String(handoff.payload)), actionTurnId }),
					handoffId,
				);
			this.event(taskId, "document_handoff_action_started", {
				handoffId,
				actionTurnId,
			});
			return actionTurnId;
		});
	}
	completeHandoff(
		taskId: string,
		actionTurnId: string,
		handoffId: string,
		result: { binding: TargetBinding | null; result: unknown; actionId: string; failed?: boolean },
	): Receipt {
		return this.transaction(() => {
			this.expect(taskId, actionTurnId, "running");
			if (
				this.db
					.prepare("SELECT cancellation_requested FROM tasks WHERE id=?")
					.get(taskId)!.cancellation_requested
			)
				throw new Error("Cancelled handoff cannot continue");
			const handoff = this.db
				.prepare("SELECT * FROM records WHERE kind='handoff' AND id=?")
				.get(handoffId);
			if (
				!handoff ||
				handoff.state !== "action_running" ||
				handoff.task_id !== taskId ||
				JSON.parse(String(handoff.payload)).actionTurnId !== actionTurnId ||
				(result.failed
					? canonical(result.binding) !== canonical(JSON.parse(String(this.db.prepare("SELECT owner FROM turns WHERE id=?").get(JSON.parse(String(handoff.payload)).oldTurnId)?.owner ?? "null"))?.binding ?? null)
					: !this.authorizationAdditions(taskId).some(b => canonical(b) === canonical(result.binding)))
			)
				throw new Error("Handoff action is not verified");
			if (this.unresolvedTurn(actionTurnId))
				throw new Error("Handoff operation or scope cleanup unresolved");
			this.db
				.prepare(
					"UPDATE turns SET state='completed',cleanup_confirmed=1 WHERE id=?",
				)
				.run(actionTurnId);
			const turnId = randomUUID();
			this.db
				.prepare("INSERT INTO turns(id,task_id,state) VALUES (?,?,'queued')")
				.run(turnId, taskId);
			this.db.prepare("UPDATE tasks SET state='queued' WHERE id=?").run(taskId);
			this.db
				.prepare(
					"UPDATE records SET state='completed',payload=? WHERE kind='handoff' AND id=?",
				)
				.run(
					canonical({
						...JSON.parse(String(handoff.payload)),
						continuationId: turnId,
						...result,
					}),
					handoffId,
				);
			return {
				taskId,
				turnId,
				eventId: this.event(taskId, "document_handoff_completed", {
					handoffId,
					turnId,
					...result,
				}),
			};
		});
	}

	authorizationAdditions(taskId: string): TargetBinding[] {
		return this.db
			.prepare(
				"SELECT payload FROM records WHERE kind='authorization' AND task_id=? AND state='verified'",
			)
			.all(taskId)
			.map((row) => JSON.parse(String(row.payload)).binding as TargetBinding);
	}
	/** Commit readiness and delegation access together without retargeting the current turn. */
	completeRhinoLaunch(id: string, binding: TargetBinding, result: unknown): void {
		if (!validateTargetBinding(binding).ok || binding.kind !== "rhino") throw new Error("Invalid launch binding");
		this.transaction(() => {
			const action = this.db.prepare("SELECT * FROM records WHERE kind='launch' AND id=?").get(id);
			if (!action || !["dispatched", "uncertain"].includes(String(action.state))) throw new Error("Launch is not awaiting readiness");
			const task = this.db.prepare("SELECT * FROM tasks WHERE id=?").get(action.task_id);
			if (!task || task.parent_task_id !== null || task.state !== "running" || task.cancellation_requested)
				throw new Error("Cancelled or inactive task gains no launch authority");
			this.db.prepare("UPDATE records SET state='completed',payload=? WHERE kind='launch' AND id=?").run(canonical(result), id);
			this.db.prepare("INSERT INTO records VALUES ('authorization',?,?,?,'verified')")
				.run(id, action.task_id, canonical({ binding, actionId: id }));
			this.event(String(action.task_id), "authorization_added", { binding, actionId: id });
		});
	}
	completeGrantedAction(
		kind: "launch" | "document-action",
		id: string,
		grantId: string,
		binding: TargetBinding,
		result: unknown,
	): void {
		if (!validateTargetBinding(binding).ok)
			throw new Error("Invalid authorization binding");
		this.transaction(() => {
			const action = this.db
				.prepare("SELECT * FROM records WHERE kind=? AND id=?")
				.get(kind, id);
			const grant = this.db
				.prepare("SELECT * FROM records WHERE kind='grant' AND id=?")
				.get(grantId);
			if (
				!action ||
				!grant ||
				action.task_id !== grant.task_id ||
				action.state !== "dispatched" ||
				grant.state !== "in_flight"
			)
				throw new Error("Action or grant is not in flight");
			const task = this.db
				.prepare("SELECT * FROM tasks WHERE id=?")
				.get(action.task_id)!;
			if (
				task.cancellation_requested ||
				!["running", "suspending"].includes(String(task.state))
			)
				throw new Error("Cancelled or inactive task gains no authority");
			this.db
				.prepare(
					"UPDATE records SET state='completed',payload=? WHERE kind=? AND id=?",
				)
				.run(canonical(result), kind, id);
			this.db
				.prepare(
					"UPDATE records SET state='consumed' WHERE kind='grant' AND id=?",
				)
				.run(grantId);
			this.db
				.prepare(
					"INSERT INTO records VALUES ('authorization',?,?,?,'verified')",
				)
				.run(id, action.task_id, canonical({ binding, grantId, actionId: id }));
			this.event(String(action.task_id), "authorization_added", {
				binding,
				grantId,
				actionId: id,
			});
		});
	}

	attachment(lifecycleId: string, payload: unknown): void {
		this.db
			.prepare(
				"INSERT INTO attachments VALUES (?,?) ON CONFLICT(lifecycle_id) DO UPDATE SET payload=excluded.payload",
			)
			.run(required(lifecycleId), canonical(payload));
	}
	putRecord(
		requestId: string,
		kind: "grant" | "launch" | "artifact" | "document-action" | "transfer",
		id: string,
		taskId: string,
		payload: unknown,
	): { id: string } {
		return this.request(requestId, { kind, id, taskId, payload }, () => {
			if (
				this.db
					.prepare("SELECT cancellation_requested FROM tasks WHERE id=?")
					.get(taskId)?.cancellation_requested !== 0
			)
				throw new Error("Unknown or cancelling task");
			this.db
				.prepare("INSERT INTO records VALUES (?,?,?,?,'accepted')")
				.run(kind, id, taskId, canonical(payload));
			this.event(taskId, kind + "_accepted", { id });
			return { id };
		});
	}
	transitionRecord(
		kind: string,
		id: string,
		expected: string,
		state: string,
		payload: unknown,
	): void {
		this.transaction(() => {
			const row = this.db
				.prepare("SELECT * FROM records WHERE kind=? AND id=?")
				.get(kind, id);
			if (!row || row.state !== expected)
				throw new Error("Record state conflict");
			this.db
				.prepare("UPDATE records SET state=?,payload=? WHERE kind=? AND id=?")
				.run(state, canonical(payload), kind, id);
			this.event(String(row.task_id), kind + "_" + state, { id });
		});
	}

	getTask(taskId: string): Row | undefined {
		return this.db.prepare("SELECT * FROM tasks WHERE id=?").get(taskId);
	}
	getQuestion(questionId: string): Row | undefined {
		return this.db.prepare("SELECT * FROM questions WHERE id=?").get(questionId);
	}
	get hasQueuedTasks(): boolean {
		return Boolean(this.db.prepare("SELECT 1 FROM tasks WHERE state='queued' AND cancellation_requested=0 LIMIT 1").get());
	}

	get eventCursor(): number {
		return Number(this.db.prepare("SELECT COALESCE(MAX(id),0) AS id FROM events").get()!.id);
	}

	/** Bounded display data, independent of the complete recovery/export journal. */
	browserSnapshot(options: { conversationId?: string; before?: number; afterConversationSequence?: number } = {}) {
		return this.transaction(() => {
			const conversations = this.db.prepare(browserConversationsQuery).all().map(({ has_fixture, ...row }): Row => {
				const first = String(row.first_user_text ?? "").trim().replace(/\s+/g," ");
				const custom = !has_fixture && row.title && row.title !== "New chat" ? String(row.title) : "";
				const text = custom || first;
				const short = text.split(" ").slice(0,8).join(" ").slice(0,60);
				return { ...row, title: short ? short + (short.length < text.length ? "…" : "") : "New thread" };
			});
			const conversationId = conversations.find(row => row.id === options.conversationId)?.id
				?? conversations.find(row => !row.archived_at && Number(row.sequence) > (options.afterConversationSequence ?? 0))?.id ?? null;
			const roots = conversationId === null ? [] : this.db.prepare(`SELECT sequence,id FROM browser_roots
WHERE conversation_id=? AND NOT fixture AND sequence<? ORDER BY sequence DESC LIMIT 21`)
				.all(conversationId, options.before ?? Number.MAX_SAFE_INTEGER);
			const page = roots.slice(0, 20).reverse();
			const active = conversationId === null ? [] : this.db.prepare(`SELECT sequence,id FROM browser_roots
WHERE conversation_id=? AND NOT fixture AND state IN ('queued','running','suspending','awaiting_user') ORDER BY sequence`)
				.all(conversationId);
			const recoveryRoots = this.db.prepare(`SELECT DISTINCT browser_root_id AS id FROM (${browserRecoveryTasksQuery}) WHERE conversation_id=?`).all(conversationId);
			const visibleRoots = [...page, ...recoveryRoots];
			const rootIds = [...new Set([...visibleRoots, ...active].map(row => row.id))];
			const marks = rootIds.map(() => "?").join(",") || "NULL";
			const tasks = this.db.prepare(`SELECT rowid AS sequence,* FROM tasks WHERE id IN (${marks}) OR root_task_id IN (${marks}) OR parent_task_id IN (${marks}) ORDER BY rowid`)
				.all(...rootIds, ...rootIds, ...rootIds);
			const ids = tasks.map(row => row.id);
			const selected = ids.map(() => "?").join(",") || "NULL";
			const rows = (table: string) => this.db.prepare(`SELECT * FROM ${table} WHERE task_id IN (${selected}) ORDER BY rowid`).all(...ids);
			const conversationIds = conversations.map(row => row.id);
			return {
				conversations,
				sessions: this.db.prepare(`SELECT * FROM sessions WHERE conversation_id IN (${conversationIds.map(() => "?").join(",") || "NULL"}) AND id NOT LIKE 'worker-%' ORDER BY rowid`).all(...conversationIds),
				tasks, turns: rows("turns"), questions: rows("questions"), inputs: rows("inputs"),
				recoveries: rows("recovery_dispositions"),
				records: this.db.prepare(`SELECT * FROM records WHERE task_id IN (${selected}) AND kind='scheduling' ORDER BY rowid`).all(...ids),
				events: this.db.prepare(`SELECT id,task_id,kind,payload,created_at FROM browser_events WHERE task_id IN (${selected}) ORDER BY id`).all(...ids),
				operations: [] as Row[], reservations: [] as Row[], attachments: [] as Row[], dependencies: [] as Row[],
				history: { conversationId, before: options.before ?? null, hasOlder: roots.length > 20,
					oldestSequence: page[0]?.sequence ?? null, pageTaskIds: tasks.filter(row => visibleRoots.some(root => root.id === row.id || root.id === row.root_task_id || root.id === row.parent_task_id)).map(row => row.id) },
			};
		});
	}

	snapshot(options: { includeEvents?: boolean } = {}) {
		return this.transaction(() => ({
			conversations: this.db
				.prepare("SELECT rowid AS sequence, * FROM conversations ORDER BY rowid")
				.all(),
			sessions: this.db.prepare("SELECT * FROM sessions ORDER BY rowid").all(),
			operations: this.db
				.prepare("SELECT * FROM operations ORDER BY rowid")
				.all(),
			recoveries: this.db
				.prepare("SELECT * FROM recovery_dispositions ORDER BY rowid")
				.all(),
			reservations: this.db
				.prepare("SELECT * FROM reservations ORDER BY destination")
				.all(),
			records: this.db.prepare("SELECT * FROM records ORDER BY rowid").all(),
			attachments: this.db
				.prepare("SELECT * FROM attachments ORDER BY rowid")
				.all(),
			dependencies: this.db
				.prepare("SELECT * FROM dependencies ORDER BY rowid")
				.all(),
			tasks: this.db.prepare("SELECT * FROM tasks ORDER BY rowid").all(),
			turns: this.db.prepare("SELECT * FROM turns ORDER BY rowid").all(),
			questions: this.db
				.prepare("SELECT * FROM questions ORDER BY rowid")
				.all(),
			inputs: this.db.prepare("SELECT * FROM inputs ORDER BY id").all(),
			events: options.includeEvents === false ? [] : this.db.prepare("SELECT * FROM events ORDER BY id").all(),
		}));
	}
}
