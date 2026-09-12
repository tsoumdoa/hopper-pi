// Snapshot diffing only depends on flat wire values, never on the journal.
type Row = Record<string, string | number | null | undefined>;

const TABLES = ["conversations", "sessions", "tasks", "turns", "events", "records", "recoveries", "questions", "inputs"] as const;
type Table = typeof TABLES[number];
type SnapshotRows = Partial<Record<Table, Row[]>> & { eventCursor: number };
type Change = { upsert: Row[]; order?: string[] };
export type SnapshotPatch = { baseCursor: number; values: Record<string, unknown>; changes: Partial<Record<Table, Change>> };
const key = (row: Row) => row.kind !== undefined && row.id !== undefined ? `${row.kind}:${row.id}` : String(row.id);
const equal = (a: Row, b: Row) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(field => a[field] === b[field]);

/** Diff against the last snapshot actually written to this socket, not an overwritten queued one. */
export function snapshotPatch(previous: SnapshotRows, next: SnapshotRows): SnapshotPatch {
	const values: Record<string, unknown> = { ...next };
	const changes: SnapshotPatch["changes"] = {};
	for (const table of TABLES) {
		delete values[table];
		const old = previous[table] ?? [], rows = next[table] ?? [];
		const prior = new Map(old.map(row => [key(row), row]));
		const upsert = rows.filter(row => !prior.has(key(row)) || !equal(prior.get(key(row))!, row));
		const reordered = old.length !== rows.length || rows.some((row, index) => key(row) !== key(old[index]));
		if (upsert.length || reordered) changes[table] = { upsert, ...(reordered ? { order: rows.map(key) } : {}) };
	}
	return { baseCursor: previous.eventCursor, values, changes };
}

/** Preserve unchanged row/array identities so idle and unrelated updates do not reparse replies. */
export function applySnapshotPatch<T extends SnapshotRows>(previous: T, patch: SnapshotPatch): T {
	if (previous.eventCursor !== patch.baseCursor) throw new Error("History update is out of sequence");
	const next = { ...previous, ...patch.values };
	for (const table of TABLES) {
		const change = patch.changes[table];
		if (!change) continue;
		const prior = previous[table] ?? [];
		const rows = new Map(prior.map(row => [key(row), row]));
		for (const row of change.upsert) rows.set(key(row), row);
		next[table] = (change.order ?? prior.map(key)).map(id => {
			const row = rows.get(id);
			if (!row) throw new Error("History row is missing");
			return row;
		});
	}
	return next;
}
