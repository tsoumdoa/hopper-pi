import type { JobState } from "./messages.js";

export interface Job {
	jobId: string;
	commandId: string;
	state: JobState;
	progress: number;
	error: string | null;
	queuedAt: number;
	startedAt?: number;
	completedAt?: number;
}