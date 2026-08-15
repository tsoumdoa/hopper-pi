import {
	fromJsonSchema,
	type CallToolResult,
	type McpServer,
	type ServerContext,
	type ToolAnnotations,
} from "@modelcontextprotocol/server";
import type { HopperProgressUpdate, HopperResult, HopperToolSpec } from "../core/tool-contract.js";

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

export function createMcpToolHandler(spec: HopperToolSpec) {
	return async (args: unknown, ctx: ServerContext): Promise<CallToolResult> => {
		const progressToken = ctx.mcpReq._meta?.progressToken;
		let progress = 0;
		let pendingProgress = Promise.resolve();

		const reportProgress = progressToken === undefined
			? undefined
			: (update: HopperProgressUpdate) => {
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
				pendingProgress = pendingProgress.then(() => ctx.mcpReq.notify(notification));
			};

		const input = spec.prepareArguments ? spec.prepareArguments(args) : args;
		const result = await spec.execute(input, {
			toolCallId: String(ctx.mcpReq.id),
			signal: ctx.mcpReq.signal,
			reportProgress,
			supportsImages: true,
			hostContext: {
				model: { provider: "mcp", id: "mcp-client", input: ["text", "image"] },
			},
		});
		await pendingProgress;
		return toMcpResult(result);
	};
}

export function registerMcpTool(
	server: McpServer,
	spec: HopperToolSpec,
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
		createMcpToolHandler(spec),
	);
}
