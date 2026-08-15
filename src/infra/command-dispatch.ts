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
	options: { signal?: AbortSignal } = {},
): Promise<{ jobId: string }> {
	options.signal?.throwIfAborted();
	await ensureBackendReachable();
	options.signal?.throwIfAborted();
	const request = buildJobRequest(action, params);
	const publisher = getPublisher();
	await publisher.connect(options.signal);
	await publisher.publishCommand(request, options.signal);
	return { jobId: request.jobId };
}

export type SubmitResult = { jobId: string };
