import { createHash } from "node:crypto";
import { withRequester } from "../infra/request-helpers.js";
import { fetchCurrentCanvas } from "../tools/canvas-fetch.js";
import type { GetCurrentCanvasResponse, GhEventXml } from "../types/messages.js";

export type CanvasSnapshot = GetCurrentCanvasResponse & {
	snapshotId: string;
	revision: number;
};

export type CanvasFetcher = () => Promise<GetCurrentCanvasResponse>;

function snapshotId(xml: string): string {
	return createHash("sha256").update(xml).digest("hex");
}

export class CanvasSnapshotStore {
	private current: CanvasSnapshot | null = null;
	private revision = 0;

	constructor(
		private readonly fetchCanvas: CanvasFetcher = () =>
			withRequester((requester) => fetchCurrentCanvas(requester)),
	) {}

	peek(): CanvasSnapshot | null {
		return this.current;
	}

	async get(): Promise<CanvasSnapshot> {
		if (this.current) return this.current;
		return this.set(await this.fetchCanvas());
	}

	acceptEvent(event: GhEventXml): { changed: boolean; snapshot: CanvasSnapshot } {
		const previous = this.current;
		const next = this.set({
			type: "getCurrentCanvas.response",
			timestamp: event.timestamp,
			docName: event.docName,
			xml: event.xml,
		});
		return { changed: next !== previous, snapshot: next };
	}

	private set(response: GetCurrentCanvasResponse): CanvasSnapshot {
		const id = snapshotId(response.xml);
		if (this.current?.snapshotId === id && this.current.docName === response.docName) {
			return this.current;
		}
		this.revision += 1;
		this.current = { ...response, snapshotId: id, revision: this.revision };
		return this.current;
	}
}
