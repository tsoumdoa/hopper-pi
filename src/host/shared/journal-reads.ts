import { browserConversationsQuery, browserRecoveryTasksQuery } from "./conversation-snapshot.js";
import type { Database, Row } from "./journal-database.js";

// Multi-query reads run inside the transaction opened by TaskJournal.
export function readBrowserSnapshot(db: Database, options: { conversationId?: string; before?: number; afterConversationSequence?: number } = {}) {
	const conversations = db.prepare(browserConversationsQuery).all().map(({ has_fixture, ...row }): Row => {
		const first = String(row.first_user_text ?? "").trim().replace(/\s+/g," ");
		const custom = !has_fixture && row.title && row.title !== "New chat" ? String(row.title) : "";
		const text = custom || first;
		const short = text.split(" ").slice(0,8).join(" ").slice(0,60);
		return { ...row, title: short ? short + (short.length < text.length ? "…" : "") : "New thread" };
	});
	const conversationId = conversations.find(row => row.id === options.conversationId)?.id
		?? conversations.find(row => !row.archived_at && Number(row.sequence) > (options.afterConversationSequence ?? 0))?.id ?? null;
	const roots = conversationId === null ? [] : db.prepare(`SELECT sequence,id FROM browser_roots
WHERE conversation_id=? AND NOT fixture AND sequence<? ORDER BY sequence DESC LIMIT 21`)
		.all(conversationId, options.before ?? Number.MAX_SAFE_INTEGER);
	const page = roots.slice(0, 20).reverse();
	const active = conversationId === null ? [] : db.prepare(`SELECT sequence,id FROM browser_roots
WHERE conversation_id=? AND NOT fixture AND state IN ('queued','running','suspending','awaiting_user') ORDER BY sequence`)
		.all(conversationId);
	const recoveryRoots = db.prepare(`SELECT DISTINCT browser_root_id AS id FROM (${browserRecoveryTasksQuery}) WHERE conversation_id=?`).all(conversationId);
	const visibleRoots = [...page, ...recoveryRoots];
	const rootIds = [...new Set([...visibleRoots, ...active].map(row => row.id))];
	const marks = rootIds.map(() => "?").join(",") || "NULL";
	const tasks = db.prepare(`SELECT rowid AS sequence,* FROM tasks WHERE id IN (${marks}) OR root_task_id IN (${marks}) OR parent_task_id IN (${marks}) ORDER BY rowid`)
		.all(...rootIds, ...rootIds, ...rootIds);
	const ids = tasks.map(row => row.id);
	const selected = ids.map(() => "?").join(",") || "NULL";
	const rows = (table: string) => db.prepare(`SELECT * FROM ${table} WHERE task_id IN (${selected}) ORDER BY rowid`).all(...ids);
	const conversationIds = conversations.map(row => row.id);
	return {
		conversations,
		sessions: db.prepare(`SELECT * FROM sessions WHERE conversation_id IN (${conversationIds.map(() => "?").join(",") || "NULL"}) AND id NOT LIKE 'worker-%' ORDER BY rowid`).all(...conversationIds),
		tasks, turns: rows("turns"), questions: rows("questions"), inputs: rows("inputs"),
		recoveries: rows("recovery_dispositions"),
		records: db.prepare(`SELECT * FROM records WHERE task_id IN (${selected}) AND kind='scheduling' ORDER BY rowid`).all(...ids),
		events: db.prepare(`SELECT id,task_id,kind,payload,created_at FROM browser_events WHERE task_id IN (${selected}) ORDER BY id`).all(...ids),
		operations: [] as Row[], reservations: [] as Row[], attachments: [] as Row[], dependencies: [] as Row[],
		history: { conversationId, before: options.before ?? null, hasOlder: roots.length > 20,
			oldestSequence: page[0]?.sequence ?? null, pageTaskIds: tasks.filter(row => visibleRoots.some(root => root.id === row.id || root.id === row.root_task_id || root.id === row.parent_task_id)).map(row => row.id) },
	};
}

export function readDelegationSnapshot(db: Database, rootTaskId: string) {
	return {
		tasks: db.prepare("SELECT * FROM tasks WHERE parent_task_id=? ORDER BY rowid").all(rootTaskId),
		turns: db.prepare("SELECT * FROM turns WHERE task_id IN (SELECT id FROM tasks WHERE parent_task_id=?) ORDER BY rowid").all(rootTaskId),
		events: db.prepare("SELECT * FROM events WHERE task_id IN (SELECT id FROM tasks WHERE parent_task_id=?) ORDER BY id").all(rootTaskId),
		records: db.prepare("SELECT * FROM records WHERE kind='artifact' AND task_id IN (SELECT id FROM tasks WHERE parent_task_id=?) ORDER BY rowid").all(rootTaskId),
	};
}

export function readSchedulingSnapshot(db: Database, taskIds: string[] = []) {
	const scope = `WITH RECURSIVE relevant(id) AS (
		SELECT id FROM tasks WHERE state IN ('queued','running','suspending','awaiting_user')
			OR (state='uncertain' AND NOT EXISTS (SELECT 1 FROM recovery_dispositions r WHERE r.task_id=tasks.id))
			OR id IN (SELECT value FROM json_each(?))
		UNION SELECT t.id FROM tasks t JOIN relevant r ON t.root_task_id=r.id
		UNION SELECT t.root_task_id FROM tasks t JOIN relevant r ON t.id=r.id WHERE t.root_task_id IS NOT NULL
		UNION SELECT d.dependency_id FROM dependencies d JOIN relevant r ON d.task_id=r.id
	) `;
	const query = (sql: string) => db.prepare(scope + sql).all(JSON.stringify(taskIds));
	const selected = "SELECT id FROM relevant";
	return {
		conversations: query(`SELECT * FROM conversations WHERE id IN (SELECT conversation_id FROM tasks WHERE id IN (${selected})) ORDER BY rowid`),
		tasks: query(`SELECT id,conversation_id,session_id,state,parent_task_id,root_task_id,cancellation_requested,
			json_object('bindings',json_extract(payload,'$.bindings'),'messageTarget',json_extract(payload,'$.messageTarget')) AS payload
			FROM tasks WHERE id IN (${selected}) ORDER BY rowid`),
		turns: query(`SELECT id,task_id,state,owner,usage FROM turns WHERE task_id IN (${selected}) ORDER BY rowid`),
		operations: query(`SELECT id,task_id,turn_id,owner,state FROM operations WHERE task_id IN (${selected}) ORDER BY rowid`),
		recoveries: query(`SELECT id,task_id FROM recovery_dispositions WHERE task_id IN (${selected}) ORDER BY rowid`),
		dependencies: query(`SELECT * FROM dependencies WHERE task_id IN (${selected}) ORDER BY rowid`),
		questions: query(`SELECT id,task_id,turn_id,continuation_id FROM questions WHERE task_id IN (${selected}) ORDER BY rowid`),
		records: query(`SELECT kind,id,task_id,state,
			json_object('turnId',json_extract(payload,'$.turnId'),'continuationId',json_extract(payload,'$.continuationId'),
			'binding',json_extract(payload,'$.binding'),'grantId',json_extract(payload,'$.grantId')) AS payload
			FROM records WHERE task_id IN (${selected}) AND kind IN ('admission','handoff','scope','document-action') ORDER BY rowid`),
		attachments: db.prepare("SELECT lifecycle_id,json_object('processId',json_extract(payload,'$.processId'),'processStartTime',json_extract(payload,'$.processStartTime')) AS payload FROM attachments ORDER BY rowid").all(),
	};
}

export function readConversationSnapshot(db: Database, conversationId: string | null) {
	const conversations = db.prepare("SELECT rowid AS sequence,* FROM conversations WHERE id=?").all(conversationId);
	const rows = (table: string) => db.prepare(`SELECT * FROM ${table} WHERE task_id IN (SELECT id FROM tasks WHERE conversation_id=?) ORDER BY ${table === "events" || table === "inputs" ? "id" : "rowid"}`).all(conversationId);
	return {
		conversations,
		sessions: db.prepare("SELECT * FROM sessions WHERE conversation_id=? ORDER BY rowid").all(conversationId),
		tasks: db.prepare("SELECT * FROM tasks WHERE conversation_id=? ORDER BY rowid").all(conversationId),
		turns: rows("turns"), inputs: rows("inputs"), questions: rows("questions"), events: rows("events"),
		operations: rows("operations"), recoveries: rows("recovery_dispositions"), records: rows("records"), dependencies: rows("dependencies"),
	};
}

export function readSnapshot(db: Database, options: { includeEvents?: boolean } = {}) {
	return {
		conversations: db
			.prepare("SELECT rowid AS sequence, * FROM conversations ORDER BY rowid")
			.all(),
		sessions: db.prepare("SELECT * FROM sessions ORDER BY rowid").all(),
		operations: db
			.prepare("SELECT * FROM operations ORDER BY rowid")
			.all(),
		recoveries: db
			.prepare("SELECT * FROM recovery_dispositions ORDER BY rowid")
			.all(),
		reservations: db
			.prepare("SELECT * FROM reservations ORDER BY destination")
			.all(),
		records: db.prepare("SELECT * FROM records ORDER BY rowid").all(),
		attachments: db
			.prepare("SELECT * FROM attachments ORDER BY rowid")
			.all(),
		dependencies: db
			.prepare("SELECT * FROM dependencies ORDER BY rowid")
			.all(),
		tasks: db.prepare("SELECT * FROM tasks ORDER BY rowid").all(),
		turns: db.prepare("SELECT * FROM turns ORDER BY rowid").all(),
		questions: db
			.prepare("SELECT * FROM questions ORDER BY rowid")
			.all(),
		inputs: db.prepare("SELECT * FROM inputs ORDER BY id").all(),
		events: options.includeEvents === false ? [] : db.prepare("SELECT * FROM events ORDER BY id").all(),
	};
}
