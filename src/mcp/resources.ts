import { readFile } from "node:fs/promises";
import {
	McpServer,
	ResourceNotFoundError,
	ResourceTemplate,
} from "@modelcontextprotocol/server";
import { formatBackendEndpoint, probeBackend } from "../infra/backend-status.js";
import { formatCanvasResponse } from "../presenters/canvas-formatter.js";
import { CanvasSnapshotStore } from "./canvas-snapshot-store.js";

export const BACKEND_STATUS_URI = "hopper://backend/status";
export const CANVAS_URI = "hopper://grasshopper/canvas";
export const SUBGRAPH_URI_TEMPLATE = "hopper://grasshopper/subgraphs/{subgraph}";
export const REFERENCE_URI_TEMPLATE = "hopper://reference/{document}";

const REFERENCE_PATHS = {
	"gh-modeling-expert": "../../mds/skills/gh-modeling-expert/SKILL.md",
	"rhino-document": "../../mds/skills/rhino-document/SKILL.md",
	"gh-cookbook": "../../mds/skills/gh-cookbook/SKILL.md",
	"apply-graph": "../../mds/reference/apply-graph.md",
	"canvas-navigation": "../../mds/reference/canvas-navigation.md",
	"csharp-boilerplate": "../../mds/reference/csharp-boilerplate.md",
	"data-type-guide": "../../mds/reference/data-type-guide.md",
	"layout-system": "../../mds/reference/layout-system.md",
	"python-boilerplate": "../../mds/reference/python-boilerplate.md",
	"rhino-script-boilerplate": "../../mds/reference/rhino-script-boilerplate.md",
	"script-component-lifecycle": "../../mds/reference/script-component-lifecycle.md",
	...Object.fromEntries(Array.from({ length: 10 }, (_, index) => [
		`recipe-${index}`,
		`../../mds/skills/gh-cookbook/reference/recipe-${index}-${[
			"rectangle-surface", "subdivide-surface", "extract-edges", "loft-curves", "extrude",
			"pipe-sweep", "dispatch-pattern", "populate-points", "project-points", "bake-geometry",
		][index]}.md`,
	])),
} as Record<string, string>;

export const REFERENCE_DOCUMENTS = Object.keys(REFERENCE_PATHS).sort();

export type HopperResourceOptions = {
	snapshotStore: CanvasSnapshotStore;
	onSubgraphRead?: (uri: string) => void;
	probe?: typeof probeBackend;
};

function jsonResource(uri: URL, value: unknown) {
	return {
		contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(value, null, 2) }],
	};
}

function canvasPayload(
	snapshot: Awaited<ReturnType<CanvasSnapshotStore["get"]>>,
	subgraph?: string,
): Record<string, unknown> | null {
	const index = formatCanvasResponse(snapshot);
	const indexDetails = index.details as Record<string, unknown>;
	const subgraphs = (indexDetails.subGraphs ?? []) as Array<{ id: string }>;
	if (subgraph && !subgraphs.some((item) => item.id === subgraph)) return null;
	const formatted = subgraph ? formatCanvasResponse(snapshot, { subgraph }) : index;
	return {
		...formatted.details,
		sourceTimestamp: snapshot.timestamp,
		snapshotId: snapshot.snapshotId,
		revision: snapshot.revision,
	};
}

export function registerHopperResources(server: McpServer, options: HopperResourceOptions): void {
	server.registerResource(
		"backend-status",
		BACKEND_STATUS_URI,
		{
			title: "Hopper backend status",
			description: "Current reachability of the local Grasshopper backend.",
			mimeType: "application/json",
			cacheHint: { ttlMs: 1000, cacheScope: "private" },
		},
		async (uri) => {
			const status = await (options.probe ?? probeBackend)();
			return jsonResource(uri, {
				...status,
				endpoint: formatBackendEndpoint(),
				checkedAt: Date.now(),
			});
		},
	);

	server.registerResource(
		"grasshopper-canvas",
		CANVAS_URI,
		{
			title: "Grasshopper canvas index",
			description: "Compact index of the active Grasshopper canvas.",
			mimeType: "application/json",
			cacheHint: { ttlMs: 0, cacheScope: "private" },
		},
		async (uri) => jsonResource(uri, canvasPayload(await options.snapshotStore.get())),
	);

	server.registerResource(
		"grasshopper-subgraph",
		new ResourceTemplate(SUBGRAPH_URI_TEMPLATE, {
			list: undefined,
			complete: {
				subgraph: async (value) => {
					const payload = canvasPayload(await options.snapshotStore.get());
					const ids = (payload?.subGraphs ?? []) as Array<{ id: string }>;
					return ids.map((item) => item.id).filter((id) => id.startsWith(value));
				},
			},
		}),
		{
			title: "Grasshopper subgraph",
			description: "Detailed components and wires for one canvas subgraph.",
			mimeType: "application/json",
			cacheHint: { ttlMs: 0, cacheScope: "private" },
		},
		async (uri, variables) => {
			const subgraph = variables.subgraph;
			if (typeof subgraph !== "string") throw new ResourceNotFoundError(uri.href);
			const payload = canvasPayload(await options.snapshotStore.get(), subgraph);
			if (!payload) throw new ResourceNotFoundError(uri.href, `Unknown subgraph: ${subgraph}`);
			options.onSubgraphRead?.(uri.href);
			return jsonResource(uri, payload);
		},
	);

	server.registerResource(
		"hopper-reference",
		new ResourceTemplate(REFERENCE_URI_TEMPLATE, {
			list: async () => ({
				resources: REFERENCE_DOCUMENTS.map((document) => ({
					name: document,
					title: document.replaceAll("-", " "),
					uri: `hopper://reference/${document}`,
					mimeType: "text/markdown",
				})),
			}),
			complete: {
				document: (value) => REFERENCE_DOCUMENTS.filter((name) => name.startsWith(value)),
			},
		}),
		{
			title: "Hopper reference",
			description: "Allowlisted Hopper workflow and modeling reference.",
			mimeType: "text/markdown",
			cacheHint: { ttlMs: 86_400_000, cacheScope: "public" },
		},
		async (uri, variables) => {
			const document = variables.document;
			const path = typeof document === "string" ? REFERENCE_PATHS[document] : undefined;
			if (!path) throw new ResourceNotFoundError(uri.href);
			const text = await readFile(new URL(path, import.meta.url), "utf8");
			return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
		},
	);
}
