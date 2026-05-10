import { nanoid } from "nanoid";
import { Publisher } from "../infra/publisher.js";
import { Subscriber } from "../infra/subscriber.js";
import { COMMAND_ACK_TIMEOUT_MS } from "../infra/connection.js";
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

export async function waitForAck(jobId: string): Promise<{ commandId: string | null }> {
	const subscriber = new Subscriber();
	try {
		await subscriber.connect();
		await subscriber.subscribeTopic("gh.job.status");

		const deadline = Date.now() + COMMAND_ACK_TIMEOUT_MS;
		while (Date.now() < deadline) {
			try {
				const msg = await subscriber.receiveOne();
				if (msg?.type === "gh.job.status" && msg.jobId === jobId && msg.state === "queued") {
					return { commandId: msg.commandId };
				}
			} catch {
				break;
			}
		}
		return { commandId: null };
	} finally {
		await subscriber.close();
	}
}

export async function publishAndWaitForAck(request: SubmitJobRequest): Promise<{ jobId: string; commandId: string | null }> {
	const publisher = new Publisher();
	try {
		await publisher.connect();
		await publisher.publishCommand(request);
		const { commandId } = await waitForAck(request.jobId);
		return { jobId: request.jobId, commandId };
	} finally {
		await publisher.close();
	}
}

export async function submitCommand(
	action: CommandAction,
	params: unknown
): Promise<{ jobId: string; commandId: string | null }> {
	const request = buildJobRequest(action, params);
	return publishAndWaitForAck(request);
}

export type SubmitResult = { jobId: string; commandId: string | null };

export function createExecute<P>(
	action: CommandAction,
	/** Converts tool params → command payload sent to the backend */
	mapParams: (params: P) => unknown,
	/** Builds result text returned to the AI after command completes */
	formatMessage: (params: P, result: SubmitResult) => string,
	/** Builds progress notification text shown while executing */
	progressMsg?: (params: P) => string,
) {
	return async (_toolCallId: string, params: P, _signal: unknown, onUpdate: unknown): Promise<AgentToolResult<unknown>> => {
		if (typeof onUpdate === "function") {
			(onUpdate as (msg: { content: TextContent[]; details: unknown }) => void)({
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
