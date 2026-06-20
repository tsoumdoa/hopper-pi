import assert from "node:assert/strict";
import { test } from "vitest";
import { formatCanvasResponse } from "./canvas-formatter.js";
import type { GetCurrentCanvasResponse } from "../types/messages.js";

function makeResponse(xml: string, docName = "TestDoc"): GetCurrentCanvasResponse {
	return { type: "getCurrentCanvas.response", timestamp: 1, docName, xml };
}

const PANEL_XML = `<?xml version="1.0" encoding="utf-8"?>
<Archive name="Root">
  <items count="1">
    <item name="ArchiveVersion" type_name="gh_version">
      <Major>1</Major><Minor>0</Minor><Revision>0</Revision>
    </item>
  </items>
  <chunks count="1">
    <chunk name="Definition">
      <chunks count="1">
        <chunk name="DefinitionObjects">
          <chunks count="1">
            <chunk name="Object">
              <items count="2">
                <item name="GUID" type_name="gh_guid">59c8e432-94f0-4f46-8f89-8412a925ed2c</item>
                <item name="Name" type_name="gh_string">Panel</item>
              </items>
              <chunks count="1">
                <chunk name="Container">
                  <items count="3">
                    <item name="InstanceGuid" type_name="gh_guid">aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee</item>
                    <item name="NickName" type_name="gh_string">MyPanel</item>
                    <item name="UserText" type_name="gh_string">Hello Panel</item>
                  </items>
                </chunk>
              </chunks>
            </chunk>
          </chunks>
        </chunk>
      </chunks>
    </chunk>
  </chunks>
</Archive>`;

const SOURCE_OUTPUT_GUID = "11111111-aaaa-bbbb-cccc-222222222222";

function connectedObjectXml(): string {
	return `<chunk name="Object">
  <items count="2">
    <item name="GUID" type_name="gh_guid">3dede2b9-0d3c-4e97-b40f-3433026a8de1</item>
    <item name="Name" type_name="gh_string">Number Slider</item>
  </items>
  <chunks count="1">
    <chunk name="Container">
      <items count="2">
        <item name="InstanceGuid" type_name="gh_guid">aaaaaaaa-1111-2222-3333-444444444444</item>
        <item name="NickName" type_name="gh_string">Src</item>
      </items>
      <chunks count="1">
        <chunk name="ParameterData">
          <items count="2">
            <item name="InputCount" type_name="gh_int32">0</item>
            <item name="OutputCount" type_name="gh_int32">1</item>
          </items>
          <chunks count="1">
            <chunk name="OutputParam">
              <items count="2">
                <item name="NickName" type_name="gh_string">Output</item>
                <item name="InstanceGuid" type_name="gh_guid">${SOURCE_OUTPUT_GUID}</item>
              </items>
            </chunk>
          </chunks>
        </chunk>
      </chunks>
    </chunk>
  </chunks>
</chunk>
<chunk name="Object">
  <items count="2">
    <item name="GUID" type_name="gh_guid">59c8e432-94f0-4f46-8f89-8412a925ed2c</item>
    <item name="Name" type_name="gh_string">Panel</item>
  </items>
  <chunks count="1">
    <chunk name="Container">
      <items count="3">
        <item name="InstanceGuid" type_name="gh_guid">bbbbbbbb-1111-2222-3333-555555555555</item>
        <item name="NickName" type_name="gh_string">Dst</item>
        <item name="Source" type_name="gh_guid" index="0">${SOURCE_OUTPUT_GUID}</item>
      </items>
      <chunks count="1">
        <chunk name="ParameterData">
          <items count="2">
            <item name="InputCount" type_name="gh_int32">1</item>
            <item name="OutputCount" type_name="gh_int32">0</item>
          </items>
          <chunks count="1">
            <chunk name="InputParam">
              <items count="2">
                <item name="NickName" type_name="gh_string">Input</item>
                <item name="InstanceGuid" type_name="gh_guid">cccccccc-1111-2222-3333-666666666666</item>
              </items>
              <items count="1">
                <item name="Source" type_name="gh_guid" index="0">${SOURCE_OUTPUT_GUID}</item>
              </items>
            </chunk>
          </chunks>
        </chunk>
      </chunks>
    </chunk>
  </chunks>
</chunk>
<chunk name="Object">
  <items count="2">
    <item name="GUID" type_name="gh_guid">3dede2b9-0d3c-4e97-b40f-3433026a8de1</item>
    <item name="Name" type_name="gh_string">Number Slider</item>
  </items>
  <chunks count="1">
    <chunk name="Container">
      <items count="2">
        <item name="InstanceGuid" type_name="gh_guid">dddddddd-1111-2222-3333-777777777777</item>
        <item name="NickName" type_name="gh_string">Iso</item>
      </items>
    </chunk>
  </chunks>
</chunk>`;
}

function wrapArchive(objectsXml: string): string {
	return `<?xml version="1.0" encoding="utf-8"?>
<Archive name="Root">
  <items count="1">
    <item name="ArchiveVersion" type_name="gh_version">
      <Major>1</Major><Minor>0</Minor><Revision>0</Revision>
    </item>
  </items>
  <chunks count="1">
    <chunk name="Definition">
      <chunks count="1">
        <chunk name="DefinitionObjects">
          <chunks count="3">
            ${objectsXml}
          </chunks>
        </chunk>
      </chunks>
    </chunk>
  </chunks>
</Archive>`;
}

const MULTI_CANVAS_XML = wrapArchive(connectedObjectXml());

test("formatCanvasResponse (no subgraphs) returns detail view with component info", () => {
	const result = formatCanvasResponse(makeResponse(PANEL_XML));
	const text = result.content[0]?.type === "text" ? result.content[0].text : "";
	assert.match(text, /Canvas: TestDoc/);
	assert.match(text, /MyPanel/);
	assert.match(text, /panel: "Hello Panel"/);
	const details = result.details as Record<string, unknown>;
	assert.equal(details.componentCount, 1);
});

test("formatCanvasResponse (with subgraphs) returns index view", () => {
	const result = formatCanvasResponse(makeResponse(MULTI_CANVAS_XML, "MultiDoc"));
	const text = result.content[0]?.type === "text" ? result.content[0].text : "";
	assert.match(text, /Canvas: MultiDoc/);
	assert.match(text, /Sub-graph index|Isolated/);
	const details = result.details as Record<string, unknown>;
	assert.equal(details.componentCount, 3);
	assert.ok((details.subGraphCount as number) >= 2, "should have multiple subgraphs");
});

test("formatCanvasResponse with subgraph filter shows detail for that subgraph", () => {
	const indexResult = formatCanvasResponse(makeResponse(MULTI_CANVAS_XML));
	const details = indexResult.details as { subGraphs: Array<{ id: string }> };
	const firstSubId = details.subGraphs[0].id;

	const result = formatCanvasResponse(makeResponse(MULTI_CANVAS_XML), { subgraph: firstSubId });
	const text = result.content[0]?.type === "text" ? result.content[0].text : "";
	assert.match(text, new RegExp(`Sub-graph: ${firstSubId}`));
});

test("formatCanvasResponse with selectionOnly returns empty message when nothing selected", () => {
	const result = formatCanvasResponse(makeResponse(PANEL_XML), { selectionOnly: true });
	const text = result.content[0]?.type === "text" ? result.content[0].text : "";
	assert.match(text, /No objects selected/i);
	const details = result.details as Record<string, unknown>;
	assert.equal(details.componentCount, 0);
});

test("formatCanvasResponse with selectionOnly returns selected components", () => {
	const response = makeResponse(PANEL_XML);
	response.selectedInstanceGuids = ["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"];
	const result = formatCanvasResponse(response, { selectionOnly: true });
	const text = result.content[0]?.type === "text" ? result.content[0].text : "";
	assert.match(text, /MyPanel/);
	const details = result.details as Record<string, unknown>;
	assert.equal(details.componentCount, 1);
});

test("formatCanvasResponse details include shortened GUIDs", () => {
	const result = formatCanvasResponse(makeResponse(PANEL_XML));
	const details = result.details as { components: Record<string, { instanceGuid: string }> };
	const comp = Object.values(details.components)[0];
	assert.ok(comp.instanceGuid.length < 36, "GUID should be shortened");
});
