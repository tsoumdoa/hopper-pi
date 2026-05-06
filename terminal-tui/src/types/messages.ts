export type JobState = "queued" | "running" | "completed" | "failed" | "cancelled";

export type GhJobStatus = {
	type: "gh.job.status";
	timestamp: number;
	jobId: string;
	commandId: string;
	state: JobState;
	progress: number;
	error: string | null;
};

export type GhEventXml = {
	type: "gh.event.xml";
	timestamp: number;
	docName: string;
	xml: string;
};

export type GhMessage = GhJobStatus | GhEventXml;
