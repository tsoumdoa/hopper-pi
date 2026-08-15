#!/usr/bin/env node

import { readFileSync, realpathSync } from "node:fs";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { serveStdio, StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createHopperMcpServer } from "./create-server.js";
import { CanvasSnapshotStore } from "./canvas-snapshot-store.js";
import { DocumentUpdateBridge } from "./document-update-bridge.js";

export type HopperStdioOptions = {
	modernOnly: boolean;
};

export function parseStdioArgs(args: readonly string[]): HopperStdioOptions {
	const unknown = args.filter((arg) => arg !== "--modern-only");
	if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown[0]}`);
	return { modernOnly: args.includes("--modern-only") };
}

/**
 * The SDK transport intentionally does not treat stdin EOF as a close. Hopper
 * also owns a long-lived ZeroMQ subscriber, so tie that resource to both EOF
 * and every other transport close path.
 */
export class HopperStdioTransport extends StdioServerTransport {
	private closed = false;
	private readonly onInputEnd = () => {
		void this.close().catch((error) => console.error(error));
	};

	constructor(
		private readonly input: Readable,
		output: Writable,
		private readonly onShutdown: () => Promise<void>,
	) {
		super(input, output);
	}

	override async start(): Promise<void> {
		this.input.once("end", this.onInputEnd);
		this.input.once("close", this.onInputEnd);
		await super.start();
	}

	override async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.input.off("end", this.onInputEnd);
		this.input.off("close", this.onInputEnd);
		await super.close();
		await this.onShutdown();
	}
}

function packageVersion(): string {
	const packageJson = JSON.parse(
		readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
	) as { version?: unknown };
	if (typeof packageJson.version !== "string") throw new Error("package.json has no version");
	return packageJson.version;
}

export function startHopperStdio(options: HopperStdioOptions) {
	const version = packageVersion();
	const snapshots = new CanvasSnapshotStore();
	const bridge = new DocumentUpdateBridge(snapshots);
	bridge.start();
	const transport = new HopperStdioTransport(process.stdin, process.stdout, () => bridge.close());
	const handle = serveStdio(
		() => {
			const server = createHopperMcpServer({
				version,
				snapshotStore: snapshots,
				onSubgraphRead: (uri) => bridge.trackSubgraph(uri),
			});
			const remove = bridge.addServer(server);
			const previousClose = server.server.onclose;
			server.server.onclose = () => {
				remove();
				previousClose?.();
			};
			return server;
		},
		{
			legacy: options.modernOnly ? "reject" : "serve",
			transport,
			onerror(error) {
				console.error(error);
			},
		},
	);
	return {
		async close() {
			await handle.close();
		},
	};
}

// npm links package bins through node_modules/.bin. Compare real paths so the
// symlinked hopper-mcp executable still starts instead of looking like an import.
const isMain = process.argv[1] !== undefined &&
	realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (isMain) {
	try {
		startHopperStdio(parseStdioArgs(process.argv.slice(2)));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
