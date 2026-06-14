import assert from "node:assert/strict";
import { test } from "vitest";
import { buildGhJson } from "./parser.js";

const MINIMAL_ARCHIVE = `<?xml version="1.0" encoding="utf-8"?>
<Archive name="Root">
  <items count="1">
    <item name="ArchiveVersion" type_name="gh_version">
      <Major>1</Major>
      <Minor>0</Minor>
      <Revision>0</Revision>
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

test("buildGhJson parses empty DefinitionObjects", () => {
	const result = buildGhJson(MINIMAL_ARCHIVE);
	assert.equal(result.version, "1.0.0");
	assert.deepEqual(result.components, {});
	assert.deepEqual(result.wires, []);
});
