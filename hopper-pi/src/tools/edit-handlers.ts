import { nanoid } from "nanoid";
import { getPublisher } from "../infra/publisher.js";
import { defineTool, type AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { TextContent } from "@earendil-works/pi-ai";
import type {
	CommandAction,
	SubmitJobRequest,
} from "../types/commands.js";

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
	const request = buildJobRequest(action, params);
	const publisher = getPublisher();
	await publisher.connect();
	await publisher.publishCommand(request);
	return { jobId: request.jobId };
}

export type SubmitResult = { jobId: string };

type ProgressFn = (msg: { content: TextContent[]; details: unknown }) => void;

export function createExecute<P>(
	action: CommandAction,
	mapParams: (params: P) => unknown,
	formatMessage: (params: P, result: SubmitResult) => string,
	progressMsg?: (params: P) => string,
) {
	return async (_toolCallId: string, params: P, _signal: unknown, onUpdate: unknown): Promise<AgentToolResult<unknown>> => {
		const progressFn = typeof onUpdate === "function"
			? (onUpdate as ProgressFn)
			: undefined;

		if (progressFn) {
			progressFn({
				content: [{ type: "text" as const, text: progressMsg?.(params) ?? `Executing ${action}...` }],
				details: {},
			});
		}

		const result = await submitCommand(action, mapParams(params));

		return {
			content: [{ type: "text" as const, text: formatMessage(params, result) }],
			details: result,
		};
	};
}
