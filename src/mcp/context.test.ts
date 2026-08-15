import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { McpServer } from "@modelcontextprotocol/server";
import { test } from "vitest";
import type { GhEventXml } from "../types/messages.js";
import { CanvasSnapshotStore } from "./canvas-snapshot-store.js";
import { createHopperMcpServer } from "./create-server.js";
import { DocumentUpdateBridge } from "./document-update-bridge.js";
import { CANVAS_URI, REFERENCE_DOCUMENTS } from "./resources.js";

const EMPTY_CANVAS_XML = `<?xml version="1.0" encoding="utf-8"?>
<Archive name="Root"><items count="1"><item name="ArchiveVersion" type_name="gh_version">
<Major>1</Major><Minor>0</Minor><Revision>0</Revision></item></items><chunks count="1">
<chunk name="Definition"><chunks count="1"><chunk name="DefinitionObjects"><chunks count="0" />
</chunk></chunks></chunk></chunks></Archive>`;

test("canvas snapshot store deduplicates exact published snapshots", async () => {
	const store = new CanvasSnapshotStore(async () => ({
		type: "getCurrentCanvas.response",
		timestamp: 1,
		docName: "base.gh",
		xml: "base",
	}));
	const initial = await store.get();
	assert.equal(initial.revision, 1);

	const event: GhEventXml = { type: "gh.event.xml", timestamp: 2, docName: "next.gh", xml: "next" };
	const first = store.acceptEvent(event);
	const duplicate = store.acceptEvent({ ...event, timestamp: 3 });
	assert.equal(first.changed, true);
	assert.equal(first.snapshot.revision, 2);
	assert.equal(duplicate.changed, false);
	assert.equal(duplicate.snapshot.revision, 2);
});

test("document bridge invalidates canvas and tracked subgraphs without job inference", () => {
	const store = new CanvasSnapshotStore(async () => { throw new Error("unused"); });
	const notifications: string[] = [];
	const server = {
		isConnected: () => true,
		server: {
			sendResourceUpdated: async ({ uri }: { uri: string }) => { notifications.push(uri); },
		},
	} as unknown as McpServer;
	const source = { connect: async () => {}, subscribe: async () => {}, close: async () => {} };
	const bridge = new DocumentUpdateBridge(store, source as never);
	bridge.addServer(server);
	bridge.trackSubgraph("hopper://grasshopper/subgraphs/subgraph_0");
	const event: GhEventXml = { type: "gh.event.xml", timestamp: 2, docName: "test.gh", xml: "snapshot" };
	bridge.handle(event);
	bridge.handle(event);
	assert.deepEqual(notifications, [CANVAS_URI, "hopper://grasshopper/subgraphs/subgraph_0"]);
});

test("SDK exposes Hopper resources, allowlisted references, and three prompts", async () => {
	const store = new CanvasSnapshotStore(async () => ({
		type: "getCurrentCanvas.response",
		timestamp: 1,
		docName: "test.gh",
		xml: EMPTY_CANVAS_XML,
	}));
	const server = createHopperMcpServer({ version: "test", snapshotStore: store });
	const client = new Client({ name: "context-test", version: "test" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	try {
		await server.connect(serverTransport);
		await client.connect(clientTransport);
		const templates = await client.listResourceTemplates();
		assert.deepEqual(
			templates.resourceTemplates.map((item) => item.uriTemplate).sort(),
			["hopper://grasshopper/subgraphs/{subgraph}", "hopper://reference/{document}"],
		);
		const resources = await client.listResources();
		assert.ok(resources.resources.some((item) => item.uri === CANVAS_URI));
		for (const document of REFERENCE_DOCUMENTS) {
			assert.ok(resources.resources.some((item) => item.uri === `hopper://reference/${document}`));
		}
		const canvas = await client.readResource({ uri: CANVAS_URI });
		const canvasContent = canvas.contents[0];
		const canvasPayload = JSON.parse(canvasContent && "text" in canvasContent ? canvasContent.text : "{}") as Record<string, unknown>;
		assert.equal(canvasPayload.componentCount, 0);
		assert.equal(typeof canvasPayload.snapshotId, "string");
		const reference = await client.readResource({ uri: "hopper://reference/apply-graph" });
		const referenceContent = reference.contents[0];
		assert.match(referenceContent && "text" in referenceContent ? referenceContent.text : "", /gh_apply_graph/);

		const prompts = await client.listPrompts();
		assert.deepEqual(prompts.prompts.map((item) => item.name), [
			"build_grasshopper_graph",
			"inspect_and_repair_canvas",
			"model_in_rhino",
		]);
		const prompt = await client.getPrompt({
			name: "build_grasshopper_graph",
			arguments: { objective: "Make a parametric canopy" },
		});
		assert.match(prompt.messages[0]?.content.type === "text" ? prompt.messages[0].content.text : "", /gh_apply_graph/);
	} finally {
		await client.close();
		await server.close();
	}
});
