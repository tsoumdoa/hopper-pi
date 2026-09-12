import { randomUUID } from "node:crypto";
import type { Database } from "./journal-database.js";

export const journalSchemaVersion = 6;

/** The journal owns each migration transaction and the database lifetime. */
export function migrateJournal(db: Database, transaction: (work: () => void) => void): void {
	transaction(() => {
		const version = Number(
			db.prepare("PRAGMA user_version").get()!.user_version,
		);
		if (version > journalSchemaVersion)
			throw new Error(`Unsupported shared journal version ${version}`);
		if (version >= 1) return;
		db.exec(`
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
		db.prepare("INSERT INTO identity VALUES (?)").run(randomUUID());
	});
	transaction(() => {
		if (
			Number(db.prepare("PRAGMA user_version").get()!.user_version) >=
			2
		)
			return;
		db.exec(`
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
	transaction(() => {
		if (
			Number(db.prepare("PRAGMA user_version").get()!.user_version) >=
			3
		)
			return;
		db.exec(
			"ALTER TABLE conversations ADD COLUMN title TEXT NOT NULL DEFAULT ''; ALTER TABLE conversations ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0; ALTER TABLE sessions ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0; PRAGMA user_version=3;",
		);
	});
	if (
		Number(db.prepare("PRAGMA user_version").get()!.user_version) < 4
	) {
		db.exec("PRAGMA foreign_keys=OFF");
		try {
			transaction(() => {
				for (const table of ["tasks", "turns"]) {
					const schema = String(
						db
							.prepare(
								"SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
							)
							.get(table)!.sql,
					);
					db.exec(
						schema
							.replace(`CREATE TABLE ${table}`, `CREATE TABLE ${table}_v4`)
							.replace(
								"'interrupted','uncertain'",
								"'interrupted','failed','uncertain'",
							),
					);
					db.exec(
						`INSERT INTO ${table}_v4 SELECT * FROM ${table}; DROP TABLE ${table}; ALTER TABLE ${table}_v4 RENAME TO ${table};`,
					);
				}
				db.exec(
					"CREATE UNIQUE INDEX one_active_turn ON turns(task_id) WHERE state IN ('queued','running'); PRAGMA user_version=4;",
				);
				if (db.prepare("PRAGMA foreign_key_check").all().length)
					throw new Error("Journal migration foreign key check failed");
			});
		} finally {
			db.exec("PRAGMA foreign_keys=ON");
		}
	}
	transaction(() => {
		if (
			Number(db.prepare("PRAGMA user_version").get()!.user_version) >=
			5
		)
			return;
		db.exec(`
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
	transaction(() => {
		if (Number(db.prepare("PRAGMA user_version").get()!.user_version) < 6)
			db.exec(`ALTER TABLE conversations ADD COLUMN archived_at INTEGER;
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
	db.exec(`
CREATE INDEX IF NOT EXISTS tasks_by_state ON tasks(state);
CREATE INDEX IF NOT EXISTS tasks_by_root ON tasks(root_task_id);
CREATE INDEX IF NOT EXISTS tasks_by_parent ON tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS tasks_by_conversation ON tasks(conversation_id);
CREATE INDEX IF NOT EXISTS recoveries_by_task ON recovery_dispositions(task_id);
CREATE INDEX IF NOT EXISTS operations_by_task ON operations(task_id);
CREATE INDEX IF NOT EXISTS turns_by_task ON turns(task_id);
CREATE INDEX IF NOT EXISTS records_by_task ON records(task_id);
CREATE INDEX IF NOT EXISTS questions_by_task ON questions(task_id);
CREATE INDEX IF NOT EXISTS inputs_by_task ON inputs(task_id);
CREATE INDEX IF NOT EXISTS events_by_task ON events(task_id);
`);
}
