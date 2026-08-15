import type { McpServer } from "@modelcontextprotocol/server";
import { Subscriber } from "../infra/subscriber.js";
import type { GhMessage } from "../types/messages.js";
import { CANVAS_URI } from "./resources.js";
import { CanvasSnapshotStore } from "./canvas-snapshot-store.js";

type MessageSource = Pick<Subscriber, "connect" | "subscribe" | "close">;

export class DocumentUpdateBridge {
	private readonly controller = new AbortController();
	private readonly servers = new Set<McpServer>();
	private readonly subgraphUris = new Set<string>();
	private running: Promise<void> | null = null;

	constructor(
		private readonly snapshots: CanvasSnapshotStore,
		private readonly source: MessageSource = new Subscriber(),
	) {}

	trackSubgraph(uri: string): void {
		this.subgraphUris.add(uri);
	}

	addServer(server: McpServer): () => void {
		this.servers.add(server);
		return () => this.servers.delete(server);
	}

	start(): void {
		if (this.running) return;
		this.running = this.run().catch((error) => {
			if (!this.controller.signal.aborted) console.error(error);
		});
	}

	private async run(): Promise<void> {
		while (!this.controller.signal.aborted) {
			try {
				await this.source.connect();
				await this.source.subscribe((message) => this.handle(message), this.controller.signal);
			} catch (error) {
				if (!this.controller.signal.aborted) console.error(error);
			} finally {
				await this.source.close();
			}
			if (!this.controller.signal.aborted) {
				await new Promise<void>((resolve) => setTimeout(resolve, 250));
			}
		}
	}

	handle(message: GhMessage): void {
		if (message.type !== "gh.event.xml") return;
		if (!this.snapshots.acceptEvent(message).changed) return;
		const uris = [CANVAS_URI, ...this.subgraphUris];
		for (const server of this.servers) {
			if (!server.isConnected()) continue;
			for (const uri of uris) {
				void server.server.sendResourceUpdated({ uri }).catch(() => undefined);
			}
		}
	}

	async close(): Promise<void> {
		this.controller.abort();
		await this.source.close();
		await this.running;
		this.running = null;
		this.servers.clear();
	}
}
