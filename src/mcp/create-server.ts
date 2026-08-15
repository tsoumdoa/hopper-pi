import { randomBytes } from "node:crypto";
import { createRequestStateCodec, McpServer } from "@modelcontextprotocol/server";
import { HOPPER_TOOLS } from "../core/tool-registry.js";
import { registerMcpTool, toMcpToolDefinition } from "./tool-adapter.js";
import { CanvasSnapshotStore } from "./canvas-snapshot-store.js";
import { registerHopperPrompts } from "./prompts.js";
import { registerHopperResources } from "./resources.js";

export type HopperMcpServerOptions = {
	version: string;
	snapshotStore?: CanvasSnapshotStore;
	onSubgraphRead?: (uri: string) => void;
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
			cacheHints: {
				"prompts/list": { ttlMs: 3_600_000, cacheScope: "public" },
				"resources/list": { ttlMs: 3_600_000, cacheScope: "public" },
				"resources/templates/list": { ttlMs: 3_600_000, cacheScope: "public" },
			},
		},
	);

	for (const tool of HOPPER_TOOLS) {
		registerMcpTool(server, tool, { captureConsentCodec, consumeCaptureNonce });
	}
	registerHopperResources(server, {
		snapshotStore: options.snapshotStore ?? new CanvasSnapshotStore(),
		onSubgraphRead: options.onSubgraphRead,
	});
	registerHopperPrompts(server);
	return server;
}
