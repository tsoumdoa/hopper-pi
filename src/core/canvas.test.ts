import assert from "node:assert/strict";
import { test } from "vitest";
import type { CanonicalCanvas } from "./contracts.js";
import {
	canonicalizeCanvas,
	diffCanvases,
	digestCanvas,
	emptyCanvas,
} from "./canvas.js";

const MINIMAL_ARCHIVE = `<?xml version="1.0" encoding="utf-8"?>
<Archive name="GrasshopperArchive">
  <items count="1">
    <item name="ArchiveVersion" type_name="gh_version">
      <Major>0</Major><Minor>0</Minor><Revision>1</Revision>
    </item>
  </items>
  <chunks count="1">
    <chunk name="Definition">
      <chunks count="1">
        <chunk name="DefinitionObjects">
          <chunks count="0" />
        </chunk>
      </chunks>
    </chunk>
  </chunks>
</Archive>`;

test("empty canvases digest stably", () => {
	const first = emptyCanvas();
	const second = emptyCanvas();
	assert.equal(digestCanvas(first), digestCanvas(second));
	assert.equal(digestCanvas(canonicalizeCanvas(MINIMAL_ARCHIVE)), digestCanvas(first));
});

test("diff reports added, removed, moved, renamed, rewired, and group changes", () => {
	const before: CanonicalCanvas = {
		objects: [
			{ id: "a", typeId: "t", kind: "Slider", name: "A", x: 0, y: 0, properties: {} },
			{ id: "b", typeId: "t", kind: "Panel", name: "B", x: 10, y: 10, properties: { hidden: false } },
		],
		wires: [{ fromObjectId: "a", fromPort: "out", toObjectId: "b", toPort: "in" }],
		groups: [{ id: "g1", name: "one", memberIds: ["a"], properties: {} }],
	};
	const after: CanonicalCanvas = {
		objects: [
			{ id: "b", typeId: "t", kind: "Panel", name: "Bee", x: 40, y: 10, properties: { hidden: true } },
			{ id: "c", typeId: "t", kind: "Toggle", name: "C", x: 5, y: 5, properties: {} },
		],
		wires: [{ fromObjectId: "c", fromPort: "out", toObjectId: "b", toPort: "in" }],
		groups: [{ id: "g1", name: "two", memberIds: ["b", "c"], properties: {} }],
	};
	const diff = diffCanvases(before, after);
	assert.equal(diff.added.length, 1);
	assert.equal(diff.added[0]?.id, "c");
	assert.equal(diff.removed.length, 1);
	assert.equal(diff.removed[0]?.id, "a");
	assert.equal(diff.moved.length, 1);
	assert.equal(diff.moved[0]?.id, "b");
	assert.equal(diff.renamed.length, 1);
	assert.equal(diff.renamed[0]?.after, "Bee");
	assert.equal(diff.propertiesChanged.length, 1);
	assert.equal(diff.wiresAdded.length, 1);
	assert.equal(diff.wiresRemoved.length, 1);
	assert.equal(diff.groupsChanged.length, 1);
	assert.notEqual(diff.beforeDigest, diff.afterDigest);
});
