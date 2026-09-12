// Keep the adapter local while the repository supports Node 20 type definitions.
// The runtime minimum is Node 22.19, which includes node:sqlite without a flag.
export type Value = string | number | null;
export type Row = Record<string, Value>;
export interface Database {
	exec(sql: string): void;
	prepare(sql: string): {
		get(...values: Value[]): Row | undefined;
		all(...values: Value[]): Row[];
		run(...values: Value[]): { changes: number | bigint };
	};
	close(): void;
}

