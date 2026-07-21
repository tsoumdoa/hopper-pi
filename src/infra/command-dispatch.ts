import { nanoid } from "nanoid";
import { ensureBackendReachable } from "./backend-status.js";
import { getPublisher } from "./publisher.js";
import type { CommandAction, SubmitJobRequest } from "../types/commands.js";

export function buildJobRequest(action: CommandAction, params: unknown): SubmitJobRequest {
	const jobId = `job-${nanoid(8)}`;
	return {
		type: "submitJob",
		jobId,
		command: { action, params: params as SubmitJobRequest["command"]["params"] },
	};
}

export async function submitCommand(
	action: CommandAction,
	params: unknown,
): Promise<{ jobId: string }> {
	await ensureBackendReachable();
	const request = buildJobRequest(action, params);
	const publisher = getPublisher();
	await publisher.connect();
	await publisher.publishCommand(request);
	return { jobId: request.jobId };
}

export type SubmitResult = {
	jobId: string;
	/** Terminal job state when the result was observed in time ("completed" | "failed" | "cancelled"). */
	state?: string;
	/** Operation result string from the plugin (e.g. instance/port GUIDs for add operations). */
	result?: string;
	/** Error text when the job failed. */
	error?: string;
};
