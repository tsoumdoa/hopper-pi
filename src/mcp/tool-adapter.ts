import {
	fromJsonSchema,
	type CallToolResult,
	type InputRequiredResult,
	type McpServer,
	type RequestStateCodec,
	type ServerContext,
	type ToolAnnotations,
} from "@modelcontextprotocol/server";
import type { HopperProgressUpdate, HopperResult, HopperToolSpec } from "../core/tool-contract.js";
import { executeHopperTool } from "../core/execute-tool.js";
import { requireCaptureConsent } from "./capture-consent.js";

export type HopperMcpToolDefinition = {
	name: string;
	title: string;
	description: string;
	inputSchema: Record<string, unknown>;
	outputSchema: Record<string, unknown>;
	annotations: ToolAnnotations;
};

export function toMcpToolDefinition(spec: HopperToolSpec): HopperMcpToolDefinition {
	return {
		name: spec.name,
		title: spec.title,
		description: spec.description,
		inputSchema: spec.inputSchema as Record<string, unknown>,
		outputSchema: spec.outputSchema as Record<string, unknown>,
		annotations: spec.annotations,
	};
}

export function toMcpResult(result: HopperResult): CallToolResult {
	return {
		content: result.content,
		structuredContent: result.details,
		...(result.isError !== undefined ? { isError: result.isError } : {}),
	};
}

function progressMessage(update: HopperProgressUpdate): string | undefined {
	const text = update.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n");
	return text || undefined;
}

export type McpToolAdapterOptions = {
	captureConsentCodec?: RequestStateCodec<{
		purpose: "rhino_capture";
		argsHash: string;
	}>;
};

export function createMcpToolHandler(
	spec: HopperToolSpec,
	options: McpToolAdapterOptions = {},
) {
	return async (args: unknown, ctx: ServerContext): Promise<CallToolResult | InputRequiredResult> => {
		const progressToken = ctx.mcpReq._meta?.progressToken;
		let progress = 0;
		let pendingProgress = Promise.resolve();

		const reportProgress = progressToken === undefined
			? undefined
			: (update: HopperProgressUpdate) => {
				if (ctx.mcpReq.signal.aborted) return;
				progress += 1;
				const message = progressMessage(update);
				const notification = {
					method: "notifications/progress" as const,
					params: {
						progressToken,
						progress,
						...(message !== undefined ? { message } : {}),
					},
				};
				pendingProgress = pendingProgress
					.then(() => ctx.mcpReq.signal.aborted ? undefined : ctx.mcpReq.notify(notification))
					.catch(() => undefined);
			};

		const input = spec.prepareArguments ? spec.prepareArguments(args) : args;
		let captureAllowed = false;
		if (spec.name === "rh_capture_view" && options.captureConsentCodec) {
			const consent = await requireCaptureConsent(input, ctx, options.captureConsentCodec);
			if ("result" in consent) return consent.result;
			captureAllowed = true;
		}
		const result = await executeHopperTool(spec, input, {
			toolCallId: String(ctx.mcpReq.id),
			signal: ctx.mcpReq.signal,
			reportProgress,
			supportsImages: true,
			captureAllowed,
		});
		await pendingProgress;
		return toMcpResult(result);
	};
}

export function registerMcpTool(
	server: McpServer,
	spec: HopperToolSpec,
	options: McpToolAdapterOptions = {},
): void {
	const definition = toMcpToolDefinition(spec);
	server.registerTool(
		definition.name,
		{
			title: definition.title,
			description: definition.description,
			inputSchema: fromJsonSchema(definition.inputSchema),
			outputSchema: fromJsonSchema(definition.outputSchema),
			annotations: definition.annotations,
		},
		createMcpToolHandler(spec, options),
	);
}
