import { McpServer } from "@modelcontextprotocol/server";
import { HOPPER_TOOLS } from "../core/tool-registry.js";
import { registerMcpTool, toMcpToolDefinition } from "./tool-adapter.js";

export type HopperMcpServerOptions = {
	version: string;
};

export const HOPPER_MCP_TOOL_DEFINITIONS = HOPPER_TOOLS.map(toMcpToolDefinition);

export function createHopperMcpServer(options: HopperMcpServerOptions): McpServer {
	const server = new McpServer(
		{ name: "hopper-mcp", version: options.version },
		{
			instructions:
				"Use Hopper tools to inspect and edit the active Rhino document and Grasshopper canvas.",
		},
	);

	for (const tool of HOPPER_TOOLS) registerMcpTool(server, tool);
	return server;
}
