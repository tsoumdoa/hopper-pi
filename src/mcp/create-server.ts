import { randomBytes } from "node:crypto";
import { createRequestStateCodec, McpServer } from "@modelcontextprotocol/server";
import { HOPPER_TOOLS } from "../core/tool-registry.js";
import { registerMcpTool, toMcpToolDefinition } from "./tool-adapter.js";

export type HopperMcpServerOptions = {
	version: string;
};

export const HOPPER_MCP_TOOL_DEFINITIONS = HOPPER_TOOLS.map(toMcpToolDefinition);

export function createHopperMcpServer(options: HopperMcpServerOptions): McpServer {
	const captureConsentCodec = createRequestStateCodec<{
		purpose: "rhino_capture";
		argsHash: string;
		nonce: string;
	}>({
		key: randomBytes(32),
		bind: (ctx) => ctx.mcpReq.method,
	});
	const consumedCaptureNonces = new Set<string>();
	const consumeCaptureNonce = (nonce: string): boolean => {
		if (consumedCaptureNonces.has(nonce)) return false;
		consumedCaptureNonces.add(nonce);
		return true;
	};
	const server = new McpServer(
		{ name: "hopper-mcp", version: options.version },
		{
			instructions:
				"Use Hopper tools to inspect and edit the active Rhino document and Grasshopper canvas.",
			requestState: {
				verify: (state, ctx) => captureConsentCodec.verify(state, ctx),
			},
		},
	);

	for (const tool of HOPPER_TOOLS) {
		registerMcpTool(server, tool, { captureConsentCodec, consumeCaptureNonce });
	}
	return server;
}
