import assert from "node:assert/strict";
import { test } from "vitest";
import { buildGhJson } from "./index.js";
import { parseComponent } from "./component-parser.js";
import { XMLParser } from "fast-xml-parser";
import type { XmlChunk } from "../../types/parser.js";

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "",
	parseAttributeValue: false,
	parseTagValue: false,
	trimValues: true,
	isArray: (name) => ["item", "chunk"].includes(name),
});

function parseObjectChunk(xml: string): XmlChunk {
	const result = parser.parse(xml) as { chunk: XmlChunk[] };
	return result.chunk[0];
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
          <chunks count="${1}">
            ${objectsXml}
          </chunks>
        </chunk>
      </chunks>
    </chunk>
  </chunks>
</Archive>`;
}

const SLIDER_XML = `<chunk name="Object">
  <items count="2">
    <item name="GUID" type_name="gh_guid">3dede2b9-0d3c-4e97-b40f-3433026a8de1</item>
    <item name="Name" type_name="gh_string">Number Slider</item>
  </items>
  <chunks count="1">
    <chunk name="Container">
      <items count="2">
        <item name="InstanceGuid" type_name="gh_guid">aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee</item>
        <item name="NickName" type_name="gh_string">MySlider</item>
      </items>
      <chunks count="1">
        <chunk name="Slider">
          <items count="5">
            <item name="Min" type_name="gh_double">0</item>
            <item name="Max" type_name="gh_double">100</item>
            <item name="Value" type_name="gh_double">42</item>
            <item name="Digits" type_name="gh_int32">2</item>
            <item name="Interval" type_name="gh_double">0.1</item>
          </items>
        </chunk>
      </chunks>
    </chunk>
  </chunks>
</chunk>`;

const PANEL_XML = `<chunk name="Object">
  <items count="2">
    <item name="GUID" type_name="gh_guid">59c8e432-94f0-4f46-8f89-8412a925ed2c</item>
    <item name="Name" type_name="gh_string">Panel</item>
  </items>
  <chunks count="1">
    <chunk name="Container">
      <items count="3">
        <item name="InstanceGuid" type_name="gh_guid">bbbbbbbb-cccc-dddd-eeee-ffffffffffff</item>
        <item name="NickName" type_name="gh_string">MyPanel</item>
        <item name="UserText" type_name="gh_string">Hello World</item>
      </items>
    </chunk>
  </chunks>
</chunk>`;

const GROUP_XML = `<chunk name="Object">
  <items count="2">
    <item name="GUID" type_name="gh_guid">9c007eb0-9119-4a98-bc4e-0c7ac4f04082</item>
    <item name="Name" type_name="gh_string">Group</item>
  </items>
  <chunks count="1">
    <chunk name="Container">
      <items count="4">
        <item name="InstanceGuid" type_name="gh_guid">cccccccc-dddd-eeee-ffff-aaaaaaaaaaaa</item>
        <item name="NickName" type_name="gh_string">MyGroup</item>
        <item name="ID" type_name="gh_guid" index="0">aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee</item>
        <item name="ID" type_name="gh_guid" index="1">bbbbbbbb-cccc-dddd-eeee-ffffffffffff</item>
      </items>
    </chunk>
  </chunks>
</chunk>`;

const SCRIPT_BASE64 = Buffer.from("private void RunScript() { A = 1; }", "utf-8").toString("base64");

const CSHARP_SCRIPT_XML = `<chunk name="Object">
  <items count="2">
    <item name="GUID" type_name="gh_guid">04d7a2d8-1940-4d7e-b401-8e9b8d5b8a3e</item>
    <item name="Name" type_name="gh_string">C# Script</item>
  </items>
  <chunks count="1">
    <chunk name="Container">
      <items count="2">
        <item name="InstanceGuid" type_name="gh_guid">dddddddd-eeee-ffff-aaaa-bbbbbbbbbbbb</item>
        <item name="NickName" type_name="gh_string">MyScript</item>
      </items>
      <chunks count="1">
        <chunk name="Script">
          <items count="2">
            <item name="Text" type_name="gh_string">${SCRIPT_BASE64}</item>
            <item name="Title" type_name="gh_string">C# Script</item>
          </items>
        </chunk>
      </chunks>
    </chunk>
  </chunks>
</chunk>`;

test("parseComponent parses a Slider object chunk", () => {
	const chunk = parseObjectChunk(SLIDER_XML);
	const result = parseComponent(chunk);
	assert.ok(result, "parseComponent should return a result");
	assert.equal(result!.component.type, "Number Slider");
	assert.equal(result!.component.nickName, "MySlider");
	assert.equal(result!.component.value?.type, "slider");
	assert.equal(result!.component.value?.min, 0);
	assert.equal(result!.component.value?.max, 100);
	assert.equal(result!.component.value?.current, 42);
});

test("parseComponent parses a Panel object chunk", () => {
	const chunk = parseObjectChunk(PANEL_XML);
	const result = parseComponent(chunk);
	assert.ok(result, "parseComponent should return a result");
	assert.equal(result!.component.type, "Panel");
	assert.equal(result!.component.nickName, "MyPanel");
	assert.equal(result!.component.value?.type, "panel");
	assert.equal(result!.component.value?.text, "Hello World");
});

test("parseComponent parses a Group object chunk", () => {
	const groupAndSlider = `<chunks count="2">${GROUP_XML}${SLIDER_XML}</chunks>`;
	const xml = `<?xml version="1.0" encoding="utf-8"?>
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
          ${groupAndSlider}
        </chunk>
      </chunks>
    </chunk>
  </chunks>
</Archive>`;
	const parsed = buildGhJson(xml);
	const groupKey = Object.keys(parsed.components).find((k) => parsed.components[k].type === "Group");
	assert.ok(groupKey, "Group component should be parsed");
	const group = parsed.components[groupKey!];
	assert.equal(group.members?.length, 1);
});

test("parseComponent parses a C# Script object chunk", () => {
	const chunk = parseObjectChunk(CSHARP_SCRIPT_XML);
	const result = parseComponent(chunk);
	assert.ok(result, "parseComponent should return a result");
	assert.equal(result!.component.type, "C# Script");
	assert.equal(result!.component.nickName, "MyScript");
	assert.ok(result!.component.script, "script should be defined");
	assert.equal(result!.component.script!.language, "csharp");
	assert.equal(result!.component.script!.code, "private void RunScript() { A = 1; }");
});

test("parseComponent returns null for chunk without GUID", () => {
	const noGuid = `<chunk name="Object">
  <items count="1">
    <item name="Name" type_name="gh_string">NoGuid</item>
  </items>
  <chunks count="1">
    <chunk name="Container">
      <items count="1">
        <item name="InstanceGuid" type_name="gh_guid">12345678-1234-1234-1234-123456789012</item>
      </items>
    </chunk>
  </chunks>
</chunk>`;
	const chunk = parseObjectChunk(noGuid);
	const result = parseComponent(chunk);
	assert.equal(result, null);
});

test("parseComponent returns null for chunk without Container", () => {
	const noContainer = `<chunk name="Object">
  <items count="2">
    <item name="GUID" type_name="gh_guid">3dede2b9-0d3c-4e97-b40f-3433026a8de1</item>
    <item name="Name" type_name="gh_string">Number Slider</item>
  </items>
</chunk>`;
	const chunk = parseObjectChunk(noContainer);
	const result = parseComponent(chunk);
	assert.equal(result, null);
});

test("buildGhJson parses wires between connected components", () => {
	const sourceGuid = "11111111-aaaa-bbbb-cccc-222222222222";
	const targetInputSource = "11111111-aaaa-bbbb-cccc-222222222222";
	const sourceOutputGuid = "33333333-aaaa-bbbb-cccc-444444444444";

	const connectedXml = `<chunk name="Object">
  <items count="2">
    <item name="GUID" type_name="gh_guid">3dede2b9-0d3c-4e97-b40f-3433026a8de1</item>
    <item name="Name" type_name="gh_string">Number Slider</item>
  </items>
  <chunks count="1">
    <chunk name="Container">
      <items count="2">
        <item name="InstanceGuid" type_name="gh_guid">${sourceGuid}</item>
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
                <item name="InstanceGuid" type_name="gh_guid">${sourceOutputGuid}</item>
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
        <item name="InstanceGuid" type_name="gh_guid">55555555-aaaa-bbbb-cccc-666666666666</item>
        <item name="NickName" type_name="gh_string">Dst</item>
        <item name="Source" type_name="gh_guid" index="0">${targetInputSource}</item>
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
                <item name="InstanceGuid" type_name="gh_guid">77777777-aaaa-bbbb-cccc-888888888888</item>
              </items>
              <items count="1">
                <item name="Source" type_name="gh_guid" index="0">${targetInputSource}</item>
              </items>
            </chunk>
          </chunks>
        </chunk>
      </chunks>
    </chunk>
  </chunks>
</chunk>`;

	const xml = wrapArchive(connectedXml);
	const parsed = buildGhJson(xml);

	assert.equal(Object.keys(parsed.components).length, 2);
	assert.ok(parsed.wires.length >= 1, "should have at least one wire");
	const wire = parsed.wires[0];
	assert.ok(wire.from, "wire should have a from");
	assert.ok(wire.to, "wire should have a to");
});
